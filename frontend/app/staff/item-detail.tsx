import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
  Platform,
  TouchableOpacity,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useScanSessionStore } from "@/store/scanSessionStore";
import {
  theme,
} from "@/styles/modernDesignSystem";
import { useThemeContext } from "@/theme/ThemeContext";
import { ScreenContainer, GlassCard } from "@/components/ui";
import { PremiumButton } from "@/components/premium/PremiumButton";
import { PremiumInput } from "@/components/premium/PremiumInput";
import { PhotoCaptureModal } from "@/components/modals/PhotoCaptureModal";

import {
  getItemByBarcode,
  refreshItemStock,
  createCountLine,
} from "@/services/api/api";
import { RecentItemsService } from "@/services/enhancedFeatures";
import { handleErrorWithRecovery } from "@/services/errorRecovery";
import { CreateCountLinePayload } from "@/types/scan";
import { scanDeduplicationService } from "@/services/scanDeduplicationService";
import {
  normalizeSerialValue,
} from "@/utils/scanUtils";
import { useItemState } from "@/hooks/scan";
import { useNetworkStore } from "@/store/networkStore";
import { localDb } from "@/db/localDb";
import { OfflineIndicator } from "@/components/common/OfflineIndicator";

const CONDITION_OPTIONS = [
  "Good",
  "Aging",
  "Non-moving",
  "Rate Issue",
  "Scratches",
  "Damaged",
];

const BLIND_SESSION_TYPE = "BLIND" as const;

export default function ItemDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ barcode: string; sessionId: string }>();
  const { barcode, sessionId } = params;
  const { sessionType } = useScanSessionStore();
  const { theme: appTheme } = useThemeContext();
  const { colors } = appTheme;

  // Local State
  const [loading, setLoading] = useState(false);
  const [refreshingStock, setRefreshingStock] = useState(false);
  const [item, setItem] = useState<any>(null);
  const [quantity, setQuantity] = useState("1");
  const [mrp, setMrp] = useState("");
  const [mrpEditable, setMrpEditable] = useState(false);
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [categoryEditable, setCategoryEditable] = useState(false);

  // Auto-refresh timer ref
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const refreshErrorCountRef = useRef<number>(0);
  const MAX_REFRESH_ERRORS = 3; // Stop auto-refresh after 3 consecutive errors
  const AUTO_REFRESH_INTERVAL = 60000; // 60 seconds (reduced frequency)

  // Enhanced Features
  const [serialNumbers, setSerialNumbers] = useState<string[]>([]);

  const [isDamageEnabled, setIsDamageEnabled] = useState(false);
  const [damageQty, setDamageQty] = useState("");
  const [_damageType, _setDamageType] = useState<
    "returned" | "returnable" | "nonreturnable"
  >("returnable");
  const [damageRemark, setDamageRemark] = useState("");
  const [condition, setCondition] = useState("Good");

  const [mfgDate, setMfgDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [remark, setRemark] = useState("");
  const [nonReturnableDamageQty, setNonReturnableDamageQty] = useState("");

  // Photos
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [itemPhoto, setItemPhoto] = useState<any>(null);

  const { resetItemState: _resetItemState } = useItemState();

  // Load Item Details
  useEffect(() => {
    const loadItem = async () => {
      console.log("Loading Item Detail:", { barcode, sessionId });
      if (!barcode) {
        console.error("No barcode provided to ItemDetailScreen");
        return;
      }
      setLoading(true);
      try {
        const { isOnline } = useNetworkStore.getState();
        let itemData;

        if (isOnline) {
          console.log("Fetching item from API:", barcode);
          itemData = await getItemByBarcode(barcode as string);
        } else {
          console.log("Offline: Fetching item from cache:", barcode);
          // getItemByBarcode has offline cache support built in
          itemData = await getItemByBarcode(barcode as string);
        }

        if (itemData) {
          console.log("Item data received:", itemData);
          setItem(itemData);

          // Add to recent scans
          try {
            const itemCode = (itemData?.item_code || itemData?.barcode || barcode) as string;
            await RecentItemsService.addRecent(itemCode, itemData);
          } catch (e) {
            console.warn("Failed to add to recent items", e);
          }

          setMrp(
            itemData.mrp
              ? String(itemData.mrp)
              : "",
          );
          setCategory(itemData.category || "");
          setSubCategory(itemData.subcategory || "");
          // Location is handled by session store, we can still show it in logs but user requested and approved removal of manual entry and redundant badges
        } else {
          console.error("Item not found in API response");
          Alert.alert("Error", "Item not found");
          router.back();
        }
      } catch (error: any) {
        console.error("Error fetching item:", error);
        Alert.alert("Error", error.message || "Failed to load item");
        router.back();
      } finally {
        setLoading(false);
      }
    };
    if (barcode) {
      loadItem();
    } else {
      console.log("Effect triggered but no barcode yet");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcode, router]);

  const handleRefreshStock = useCallback(
    async (silent: boolean = false) => {
      // Guard against undefined item_code to prevent crashes
      if (!item || !item.item_code) {
        if (!silent) {
          console.warn("handleRefreshStock called without valid item_code");
        }
        return;
      }

      // Skip if too many consecutive errors (for silent/auto-refresh only)
      if (silent && refreshErrorCountRef.current >= MAX_REFRESH_ERRORS) {
        console.log("Skipping auto-refresh: too many consecutive errors");
        return;
      }

      setRefreshingStock(true);
      try {
        const result = await refreshItemStock(item.item_code);
        if (result.success && result.item) {
          setItem(result.item);
          refreshErrorCountRef.current = 0; // Reset error count on success
          if (!silent && Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          if (!silent) {
            Alert.alert(
              "Success",
              result.message || "Stock refreshed successfully",
            );
          }
        } else if (!silent) {
          // Handle non-success response explicitly
          Alert.alert(
            "Refresh Issue",
            result.message || "Could not refresh stock data",
          );
        }
      } catch (error: any) {
        refreshErrorCountRef.current++;
        const errorMessage = error?.message || "Failed to refresh stock";
        if (!silent) {
          Alert.alert("Error", errorMessage);
        } else {
          console.log(
            `Silent refresh failed (${refreshErrorCountRef.current}/${MAX_REFRESH_ERRORS}): ${errorMessage}`,
          );
        }
      } finally {
        setRefreshingStock(false);
      }
    },
    [item],
  );

  // Auto-refresh stock every 30 seconds
  useEffect(() => {
    if (item?.item_code && sessionType !== "BLIND") {
      // Initial silent refresh
      handleRefreshStock(true);

      // Set up interval for auto-refresh
      refreshIntervalRef.current = setInterval(() => {
        handleRefreshStock(true);
      }, AUTO_REFRESH_INTERVAL);

      return () => {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
          refreshIntervalRef.current = null;
        }
      };
    }
    return undefined;
  }, [item?.item_code, sessionType, handleRefreshStock]);

  // Adjust serial number inputs when quantity changes
  useEffect(() => {
    const validSerials = serialNumbers.filter(sn => sn && sn.trim().length > 0);
    if (validSerials.length > 0) {
      const qty = parseInt(quantity) || 0;
      setSerialNumbers((prev) => {
        if (prev.length === qty) return prev;
        if (prev.length < qty) {
          return [...prev, ...Array(qty - prev.length).fill("")];
        }
        return prev.slice(0, qty);
      });
    }
  }, [quantity, serialNumbers]);

  const clampQuantity = (val: number) => {
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.floor(val));
  };

  const setQuantityFromNumber = (val: number) => {
    const clamped = clampQuantity(val);
    setQuantity(String(clamped));
  };

  const incrementQty = (step: number = 1) => {
    const current = parseInt(quantity || "0");
    const next = clampQuantity(current + step);
    setQuantity(String(next));
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const decrementQty = (step: number = 1) => {
    const current = parseInt(quantity || "0");
    const next = clampQuantity(current - step);
    setQuantity(String(next));
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleSerialChange = (text: string, index: number) => {
    const newSerials = [...serialNumbers];
    newSerials[index] = text;
    setSerialNumbers(newSerials);
  };

  const addSerialField = () => {
    setSerialNumbers([...serialNumbers, ""]);
  };

  const validateForm = () => {
    if (!quantity || isNaN(Number(quantity)) || Number(quantity) <= 0) {
      Alert.alert("Invalid Quantity", "Please enter a valid positive quantity");
      return false;
    }

    // Flexible date validation - just check if they LOOK like dates if provided, but allow Year only
    const yearRegex = /^\d{4}$/;
    const yearMonthRegex = /^\d{4}-\d{2}$/;
    const fullDateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (mfgDate && !yearRegex.test(mfgDate) && !yearMonthRegex.test(mfgDate) && !fullDateRegex.test(mfgDate)) {
      Alert.alert("Format Issue", "Mfg Date should be YYYY, YYYY-MM, or YYYY-MM-DD");
      return false;
    }

    if (expiryDate && !yearRegex.test(expiryDate) && !yearMonthRegex.test(expiryDate) && !fullDateRegex.test(expiryDate)) {
      Alert.alert("Format Issue", "Expiry Date should be YYYY, YYYY-MM, or YYYY-MM-DD");
      return false;
    }

    const validSerials = serialNumbers.filter((s) => s.trim().length > 0);
    if (validSerials.length > 0) {
      if (validSerials.length !== Number(quantity)) {
        Alert.alert(
          "Serial Mismatch",
          `You have entered ${validSerials.length} serials but quantity is ${quantity}. They must match if serials are provided.`,
        );
        return false;
      }
    }

    if (isDamageEnabled) {
      const dQty = Number(damageQty);
      if (isNaN(dQty) || dQty < 0 || dQty > Number(quantity)) {
        Alert.alert(
          "Invalid Damage Qty",
          "Damage quantity cannot exceed total quantity.",
        );
        return false;
      }
    }

    if (sessionType === "STRICT" && item) {
      const currentStock = Number(item.current_stock || 0);
      const enteredQty = Number(quantity);
      if (enteredQty !== currentStock) {
        // In strict mode, we might want to prevent submission or just require confirmation
        // For now, let's just warn but allow if they confirm (which handleSubmit will effectively do via normal flow,
        // but let's add specific alert here if we wanted to BLOCK.
        // Requirement said "warning/alert appears", doesn't say "block".
        // Let's rely on a specific confirmation alert in handleSubmit for Strict mode variance.
      }
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    if (!item || !sessionId) return;

    // Strict Mode Variance Check
    if (sessionType === "STRICT") {
      const currentStock = Number(item.current_stock || 0);
      const enteredQty = Number(quantity);
      if (enteredQty !== currentStock) {
        const confirmed = await new Promise((resolve) => {
          Alert.alert(
            "Strict Mode Warning",
            `Counted quantity (${enteredQty}) does not match stock quantity (${currentStock}). Are you sure?`,
            [
              {
                text: "Cancel",
                onPress: () => resolve(false),
                style: "cancel",
              },
              {
                text: "Confirm Variance",
                onPress: () => resolve(true),
                style: "destructive",
              },
            ],
          );
        });
        if (!confirmed) return;
      }
    }

    setLoading(true);
    try {
      const payload: CreateCountLinePayload = {
        session_id: sessionId as string,
        item_code: item.item_code,
        batch_id: item.batch_id,
        counted_qty: Number(quantity),
        damaged_qty: isDamageEnabled ? Number(damageQty) : 0,
        item_condition: condition,
        remark: remark || undefined,
        photo_base64: itemPhoto?.base64,
        mrp_counted: mrpEditable && mrp ? Number(mrp) : undefined,
        category_correction: categoryEditable ? category : undefined,
        subcategory_correction: categoryEditable ? subCategory : undefined,
        manufacturing_date: mfgDate || undefined,
        expiry_date: expiryDate || undefined,
        floor_no: useScanSessionStore.getState().currentFloor || undefined,
        rack_no: useScanSessionStore.getState().currentRack || undefined,
        non_returnable_damaged_qty: isDamageEnabled ? Number(nonReturnableDamageQty) : 0,
      };

      const validSerials = serialNumbers.filter(sn => sn && sn.trim().length > 0);
      if (validSerials.length > 0) {
        payload.serial_numbers = validSerials.map((sn, idx) => ({
          serial_number: normalizeSerialValue(sn),
          label: `Serial #${idx + 1}`,
          value: normalizeSerialValue(sn),
          condition: "good" as const,
        }));
      }

      const { isOnline } = useNetworkStore.getState();

      if (isOnline) {
        await handleErrorWithRecovery(() => createCountLine(payload), {
          context: "Save Count",
          recovery: { maxRetries: 3 },
          showAlert: true,
        });
      } else {
        console.log("Offline: Saving to local DB queue...");
        await localDb.savePendingVerification(payload);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        isOnline ? "Success" : "Offline Success",
        isOnline
          ? "Item counted successfully"
          : "Item saved locally. It will sync when you are back online.",
        [{ text: "OK", onPress: () => router.back() }],
      );

      // Cleanup
      scanDeduplicationService.recordScan(item.item_code);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to submit count");
    } finally {
      setLoading(false);
    }
  };

  if (!item && loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.text }]}>Loading Item Details...</Text>
      </View>
    );
  }

  if (!item) return null;

  return (
    <ScreenContainer
      header={{
        title: "Item Details",
        showBackButton: true,
        showUsername: false,
        showLogoutButton: true,
      }}
      backgroundType="aurora"
      auroraVariant="primary"
      auroraIntensity="medium"
      contentMode="static"
      noPadding
      statusBarStyle="light"
      overlay={<OfflineIndicator />}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.content}>
          {/* Session Context Badge */}
          <GlassCard variant="light" style={styles.sessionBadge}>
            <View style={styles.sessionInfo}>
              <View style={styles.locationGroup}>
                <Ionicons name="location" size={18} color={colors.accent} />
                <Text style={[styles.sessionText, { color: colors.text }]}>
                  Floor: <Text style={styles.bold}>{useScanSessionStore.getState().currentFloor || "N/A"}</Text>
                </Text>
                <View style={styles.separator} />
                <Text style={[styles.sessionText, { color: colors.text }]}>
                  Rack: <Text style={styles.bold}>{useScanSessionStore.getState().currentRack || "N/A"}</Text>
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.finishRackBadge, { backgroundColor: colors.warning + '20' }]}
                onPress={() => {
                  Alert.alert(
                    "Finish Rack?",
                    "This will clear the current rack from your session. You can set a new one in the Scan screen.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Finish Rack",
                        onPress: () => {
                          useScanSessionStore.getState().setRack("");
                          router.back();
                        },
                        style: "destructive"
                      }
                    ]
                  );
                }}
              >
                <Text style={[styles.finishRackText, { color: colors.warning }]}>Finish Rack</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>

          {/* Base Info Section */}
          <GlassCard variant="medium" style={styles.infoCard}>
            <View style={styles.itemHeader}>
              <Text style={[styles.itemName, { color: colors.text }]}>{item.item_name}</Text>
              {item.barcode && (
                <View style={[styles.barcodeBadge, { backgroundColor: colors.surface }]}>
                  <Ionicons name="barcode-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.itemBarcode, { color: colors.textSecondary }]}>{item.barcode}</Text>
                </View>
              )}
              {(item.category || item.subcategory) && (
                <Text style={[styles.categoryText, { color: colors.textSecondary }]}>
                  {item.category}
                  {item.subcategory && ` / ${item.subcategory}`}
                </Text>
              )}
            </View>

            {/* Additional Identifiers */}
            {/* Additional Identifiers - Removed Batch ID and Unit badges as per user request */}
            {(item.manual_barcode || item.unit2_barcode || item.unit_m_barcode) && (
              <View style={[styles.identifiersContainer, { backgroundColor: colors.surface }]}>
                {item.manual_barcode && (
                  <View style={[styles.identifierBadge, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                    <Text style={[styles.identifierLabel, { color: colors.muted }]}>Manual:</Text>
                    <Text style={[styles.identifierValue, { color: colors.textSecondary }]}>{item.manual_barcode}</Text>
                  </View>
                )}
                {item.unit2_barcode && (
                  <View style={[styles.identifierBadge, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                    <Text style={styles.identifierLabel}>Unit 2:</Text>
                    <Text style={styles.identifierValue}>{item.unit2_barcode}</Text>
                  </View>
                )}
                {item.unit_m_barcode && (
                  <View style={[styles.identifierBadge, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                    <Text style={styles.identifierLabel}>Unit M:</Text>
                    <Text style={styles.identifierValue}>{item.unit_m_barcode}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Stock Qty Row with inline Refresh Button */}
            {sessionType !== BLIND_SESSION_TYPE ? (
              <View style={styles.stockRow}>
                <View style={[styles.stockItem, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={styles.stockLabel}>Stock Qty</Text>
                  <View style={styles.stockValueRow}>
                    <Text style={[styles.stockValue, { color: colors.text }]}>
                      {item.current_stock || item.stock_qty || 0}
                    </Text>
                    <Text style={[styles.stockUom, { color: colors.textSecondary }]}>
                      {item.uom_name || "N/A"}
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.miniRefreshButton,
                        refreshingStock && styles.refreshButtonDisabled,
                      ]}
                      onPress={() => handleRefreshStock(false)}
                      disabled={refreshingStock}
                    >
                      {refreshingStock ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.accent}
                        />
                      ) : (
                        <Ionicons
                          name="refresh"
                          size={16}
                          color={colors.accent}
                        />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : null}

            {/* Sale Price & MRP Row */}
            <View style={styles.priceRow}>
              <View style={[styles.priceItem, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.priceLabel, { color: colors.textSecondary }]}>Sale Price</Text>
                <Text style={[styles.priceValue, { color: colors.text }]}>
                  ₹{item.sales_price || "0.00"}
                </Text>
              </View>
              <View style={[styles.priceItem, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.priceLabel, { color: colors.textSecondary }]}>MRP</Text>
                <Text style={[styles.priceValue, { color: colors.text }]}>₹{item.mrp || "0.00"}</Text>
              </View>
            </View>

            {sessionType === BLIND_SESSION_TYPE ? (
              <View style={[styles.blindModeIndicator, { backgroundColor: colors.warning + '20', borderColor: colors.warning }]}>
                <Ionicons
                  name="eye-off"
                  size={16}
                  color={colors.warning}
                />
                <Text style={[styles.blindModeText, { color: colors.warning }]}>BLIND MODE</Text>
              </View>
            ) : null}

            <View style={styles.toggleRow}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Edit Details</Text>
              <Switch
                value={categoryEditable}
                onValueChange={setCategoryEditable}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={Platform.OS === "android" ? colors.surface : undefined}
              />
            </View>

            {categoryEditable && (
              <>
                <PremiumInput
                  label="Category"
                  value={category}
                  onChangeText={setCategory}
                />
                <PremiumInput
                  label="Sub Category"
                  value={subCategory}
                  onChangeText={setSubCategory}
                />
              </>
            )}

            <View style={styles.toggleRow}>
              <Text style={[styles.label, { color: colors.text }]}>MRP: {mrp}</Text>
              <Switch
                value={mrpEditable}
                onValueChange={setMrpEditable}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={Platform.OS === "android" ? colors.surface : undefined}
              />
            </View>
            {mrpEditable && (
              <PremiumInput
                label="New MRP"
                value={mrp}
                onChangeText={setMrp}
                keyboardType="numeric"
              />
            )}

            {/* Floor/Rack inputs removed as they are now session-bound and automated */}
          </GlassCard>

          {/* Count Entry Section - Prominent and easy to use */}
          <GlassCard variant="strong" style={styles.countSection}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 16 }]}>Count Entry</Text>
            <View style={styles.countRow}>
              <TouchableOpacity
                style={[styles.countButton, { backgroundColor: colors.surfaceElevated }]}
                onPress={() => decrementQty(1)}
                onLongPress={() => decrementQty(5)}
                delayLongPress={250}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.countButtonText, { color: colors.text }]}>−</Text>
              </TouchableOpacity>

              <View style={styles.countInputWrapper}>
                <PremiumInput
                  label="Physical Quantity"
                  value={quantity}
                  onChangeText={(t) => {
                    const cleaned = t.replace(/[^0-9]/g, "");
                    setQuantity(cleaned);
                  }}
                  onBlur={() => setQuantityFromNumber(parseInt(quantity || "0"))}
                  keyboardType={Platform.OS === "ios" ? "number-pad" : "numeric"}
                  inputStyle={styles.mainInput}
                />
              </View>

              <TouchableOpacity
                style={[styles.countButton, { backgroundColor: colors.surfaceElevated }]}
                onPress={() => incrementQty(1)}
                onLongPress={() => incrementQty(5)}
                delayLongPress={250}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.countButtonText, { color: colors.text }]}>＋</Text>
              </TouchableOpacity>
            </View>
            {sessionType !== BLIND_SESSION_TYPE && (
              <Text style={[styles.varianceText, { color: colors.textSecondary }]}>
                Variance: {Number(quantity || 0) - Number(item?.current_stock || item?.stock_qty || 0)}
              </Text>
            )}
          </GlassCard>

          {/* Quantities & Details Section - Moved Serial, Mfg, Condition here for better visibility */}
          <GlassCard variant="light" style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Verification Details</Text>
            </View>

            {/* Serial Numbers - Always visible for quick entry */}
            <View style={styles.detailItemRow}>
              <View style={styles.labelContainer}>
                <Ionicons name="keypad-outline" size={20} color={colors.accent} style={styles.detailIcon} />
                <Text style={[styles.label, { color: colors.text }]}>Serial Numbers</Text>
              </View>
            </View>
            <View style={styles.expandedContent}>
              {serialNumbers.length === 0 && (
                <PremiumButton
                  title="Add Serial Number"
                  onPress={addSerialField}
                  variant="outline"
                  size="small"
                />
              )}
              {serialNumbers.map((sn, index) => (
                <PremiumInput
                  key={index}
                  label={`Serial #${index + 1}`}
                  value={sn}
                  onChangeText={(text) => handleSerialChange(text, index)}
                  placeholder="Scan or enter SN"
                />
              ))}
              {serialNumbers.length > 0 && (
                <PremiumButton
                  title="Add Another"
                  onPress={addSerialField}
                  variant="ghost"
                  size="small"
                />
              )}
            </View>

            {/* Manufacturing & Expiry - Always visible or easier to access */}
            <View style={styles.detailItemRow}>
              <View style={styles.labelContainer}>
                <Ionicons name="calendar-outline" size={20} color={colors.accent} style={styles.detailIcon} />
                <Text style={[styles.label, { color: colors.text }]}>Dates (Mfg/Exp)</Text>
              </View>
            </View>
            <View style={styles.expandedContent}>
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <PremiumInput
                    label="Mfg Date"
                    value={mfgDate}
                    onChangeText={setMfgDate}
                    placeholder="YYYY or YYYY-MM"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <PremiumInput
                    label="Exp Date"
                    value={expiryDate}
                    onChangeText={setExpiryDate}
                    placeholder="YYYY or YYYY-MM"
                  />
                </View>
              </View>
              <Text style={[styles.helpText, { color: colors.textSecondary }]}>
                Supports Year only or Year-Month
              </Text>
            </View>

            {/* Condition */}
            <View style={styles.conditionContainer}>
              <Text style={[styles.subLabel, { color: colors.textSecondary }]}>Item Condition</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.conditionScroll}>
                {CONDITION_OPTIONS.map(c => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setCondition(c)}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 8,
                      borderRadius: 16,
                      backgroundColor: condition === c ? colors.accent : colors.surfaceElevated,
                      marginRight: 8,
                      borderWidth: 1,
                      borderColor: condition === c ? colors.accent : colors.border,
                    }}
                  >
                    <Text style={{ color: condition === c ? "#FFFFFF" : colors.textSecondary, fontWeight: "600", fontSize: 13 }}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <PremiumInput
              label="Remarks"
              value={remark}
              onChangeText={setRemark}
              placeholder="Any observation..."
            />
          </GlassCard>

          {/* Damage Reporting Section */}
          <View style={styles.section}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Report Damage?</Text>
              <Switch
                value={isDamageEnabled}
                onValueChange={setIsDamageEnabled}
                trackColor={{ false: colors.border, true: colors.danger }}
                thumbColor={Platform.OS === "android" ? "#fff" : undefined}
              />
            </View>

            {isDamageEnabled && (
              <View style={[styles.damageBox, { backgroundColor: colors.danger + '10', borderColor: colors.danger + '30' }]}>
                <View style={[styles.row, { gap: 12 }]}>
                  <View style={{ flex: 1 }}>
                    <PremiumInput
                      label="Returnable"
                      value={damageQty}
                      onChangeText={setDamageQty}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PremiumInput
                      label="Non-Returnable"
                      value={nonReturnableDamageQty}
                      onChangeText={setNonReturnableDamageQty}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
                <PremiumInput
                  label="Damage Type / Remark"
                  value={damageRemark}
                  onChangeText={setDamageRemark}
                  placeholder="Describe damage"
                />
              </View>
            )}
          </View>

          <View style={styles.section}>
            <PremiumButton
              title={itemPhoto ? "Photo Added" : "Add Item Photo"}
              onPress={() => setShowPhotoModal(true)}
              variant="outline"
              icon="camera"
            />
          </View>

          <PremiumButton
            title="Submit Count"
            onPress={handleSubmit}
            variant="primary"
            loading={loading}
            size="large"
            style={styles.submitButton}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <PhotoCaptureModal
        visible={showPhotoModal}
        onClose={() => setShowPhotoModal(false)}
        onCapture={setItemPhoto}
      />
    </ScreenContainer >
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.background.default,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.text.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 60 : 20,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "transparent",
  },
  backButton: {
    padding: 8,
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.text.primary,
  },
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  infoCard: {
    marginBottom: 24,
    padding: 16,
  },
  itemHeader: {
    marginBottom: 16,
  },
  itemName: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.text.primary,
    marginBottom: 4,
  },
  itemBarcode: {
    fontSize: 14,
    color: theme.colors.text.primary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  barcodeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 12,
  },
  categoryText: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    marginBottom: 12,
  },
  identifiersContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 8,
  },
  identifierBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  identifierLabel: {
    color: theme.colors.text.tertiary,
    marginRight: 4,
    fontSize: 10,
  },
  identifierValue: {
    color: theme.colors.text.secondary,
    fontWeight: "600",
    fontSize: 10,
  },
  stockRow: {
    marginBottom: 16,
  },
  stockItem: {
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  stockLabel: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    marginBottom: 4,
  },
  stockValueRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  stockValue: {
    fontSize: 32,
    fontWeight: "700",
    color: "#0EA5E9",
    marginRight: 8,
  },
  stockUom: {
    fontSize: 16,
    color: "#0EA5E9",
    marginRight: 8,
  },
  miniRefreshButton: {
    padding: 8,
    marginLeft: "auto",
  },
  refreshButtonDisabled: {
    opacity: 0.5,
  },
  priceRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 16,
  },
  priceItem: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  priceLabel: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    marginBottom: 4,
  },
  priceValue: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.text.primary,
  },
  blindModeIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  blindModeText: {
    fontSize: 14,
    color: "#F59E0B",
    fontWeight: "600",
  },
  itemCode: {
    fontSize: 12,
    color: theme.colors.text.secondary,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  detailItem: {
    alignItems: "center",
  },
  detailLabel: {
    fontSize: 14,
    color: theme.colors.text.secondary,
  },
  detailValue: {
    fontSize: 20,
    fontWeight: "600",
    color: "#0EA5E9",
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.text.primary,
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 16,
  },
  label: {
    fontSize: 16,
    color: theme.colors.text.primary,
  },
  damageBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.2)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  mainInput: {
    fontSize: 28,
    textAlign: "center",
  },
  submitButton: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.text.primary,
  },
  // Count controls layout
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  countButton: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 64,
  },
  countButtonText: {
    fontSize: 32,
    fontWeight: "700",
    color: theme.colors.text.primary,
  },
  countInputWrapper: {
    flex: 1,
  },
  varianceText: {
    marginTop: 8,
    fontSize: 16,
    color: theme.colors.text.secondary,
  },
  countSection: {
    marginBottom: 24,
    padding: 20,
  },
  sectionCard: {
    marginBottom: 24,
    padding: 16,
  },
  detailItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  detailToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailIcon: {
    width: 24,
    textAlign: 'center',
  },
  expandedContent: {
    paddingBottom: 8,
  },
  conditionContainer: {
    marginTop: 16,
    marginBottom: 8,
  },
  subLabel: {
    fontSize: 14,
    marginBottom: 12,
    fontWeight: '500',
  },
  conditionScroll: {
    marginBottom: 8,
  },
  sessionBadge: {
    marginBottom: 16,
    padding: 12,
  },
  sessionInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionText: {
    fontSize: 14,
  },
  bold: {
    fontWeight: '700',
  },
  separator: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  finishRackBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  finishRackText: {
    fontSize: 12,
    fontWeight: '700',
  },
  helpText: {
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic',
  },
});
