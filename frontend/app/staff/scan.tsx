// cspell:ignore springify
/**
 * Scan Screen - Aurora Design v2.0
 *
 * Features:
 * - Floating scan button with pulse animation
 * - Aurora background
 * - Quick actions menu
 * - Recent items carousel
 * - Smart search with suggestions
 * - Offline queue indicator
 * - Haptic feedback
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  Alert,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Keyboard,
  useWindowDimensions,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCameraPermissions, CameraView } from "expo-camera";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeInDown,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useDebounce } from "use-debounce";
import { useAuthStore } from "@/store/authStore";
import { useScanSessionStore } from "@/store/scanSessionStore";
import {
  ScreenContainer,
  GlassCard,
  FloatingScanButton,
  ScanFeedback,
  SyncStatusPill,
} from "@/components/ui";
import type { ScanFeedbackType } from "@/components/ui";
import { theme } from "@/styles/modernDesignSystem";
import { useThemeContext } from "@/theme/ThemeContext";
import {
  getItemByBarcode,
  searchItems,
  updateSessionStatus,
} from "@/services/api/api";
import { scanDeduplicationService } from "@/services/scanDeduplicationService";
import { RecentItemsService } from "@/services/enhancedFeatures";
import { searchItemsSemantic, identifyItem } from "@/services/api/api";
import { hapticService } from "@/services/hapticService";
import { useWebSocket } from "@/hooks/useWebSocket";
import { toastService } from "@/services/utils/toastService";
import { localDb } from "@/db/localDb";
import { OfflineIndicator } from "@/components/common/OfflineIndicator";
import { validateBarcode } from "@/utils/validation";

export default function ScanScreen() {
  const { theme: appTheme } = useThemeContext();
  const { colors } = appTheme;
  const { width } = useWindowDimensions();
  const { sessionId: rawSessionId } = useLocalSearchParams();
  const sessionId = Array.isArray(rawSessionId)
    ? rawSessionId[0]
    : rawSessionId;
  const router = useRouter();
  const { user: _user, logout } = useAuthStore();
  const { sessionType } = useScanSessionStore();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);

  // Multi-read validation for accurate scanning
  const scanBufferRef = useRef<{ code: string; count: number; timestamp: number }[]>([]);
  const SCAN_CONFIDENCE_THRESHOLD = 2; // Require 2 consistent reads
  const SCAN_BUFFER_TIMEOUT = 1500; // Clear buffer after 1.5s of no scans
  const SCAN_BUFFER_MAX_SIZE = 5; // Keep last 5 reads

  // States
  const [isScanning, setIsScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isAISearching, setIsAISearching] = useState(false);
  const [_searchMethod, setSearchMethod] = useState<"standard" | "semantic">("standard");
  const [scanned, setScanned] = useState(false);

  const [loading, setLoading] = useState(false);
  const [recentItems, setRecentItems] = useState<any[]>([]);
  const [showQuickActions, setShowQuickActions] = useState(false);

  // Scan feedback state
  const [showScanFeedback, setShowScanFeedback] = useState(false);
  const [scanFeedbackType, setScanFeedbackType] =
    useState<ScanFeedbackType>("success");

  // Real-time updates via WebSocket
  const { lastMessage } = useWebSocket(sessionId);

  useEffect(() => {
    if (lastMessage && lastMessage.type === "ITEM_VERIFIED") {
      console.log("[ScanScreen] Real-time update received:", lastMessage);
      toastService.show(
        `Item ${lastMessage.item_code} verified by ${lastMessage.user}`,
        "info"
      );
      // Optionally refresh recent items or search results if they contain this item
      loadRecentItems();
    }
  }, [lastMessage]);
  const [scanFeedbackMessage, setScanFeedbackMessage] = useState("");

  // Animation
  const quickActionsScale = useSharedValue(0);

  useEffect(() => {
    loadRecentItems();
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    if (!query || query.length < 3) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    setSearchMethod("standard");
    try {
      const results = await searchItems(query);
      setSearchResults(results);
      setShowResults(true);
    } catch (_error) {
      console.error("Search error:", _error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSemanticSearch = async () => {
    if (!searchQuery || searchQuery.length < 2) return;

    setIsAISearching(true);
    try {
      const results = await searchItemsSemantic(searchQuery);
      if (results.length > 0) {
        setSearchResults(results);
        setSearchMethod("semantic");
        setShowResults(true);
        hapticService.scanSuccess();
      } else {
        Alert.alert("AI Search", "No semantic matches found for your query.");
      }
    } catch {
      Alert.alert("AI Search Error", "Failed to perform semantic search.");
    } finally {
      setIsAISearching(false);
    }
  };

  const handleVisualSearch = async () => {
    if (!cameraRef.current) return;

    try {
      setIsAISearching(true);
      // Take a picture for identification
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        base64: false,
      });

      if (photo && photo.uri) {
        setLoading(true);
        const results = await identifyItem(photo.uri);

        if (results.length > 0) {
          setSearchResults(results);
          setSearchMethod("semantic");
          setShowResults(true);
          setIsScanning(false);
          setSearchQuery(""); // Clear text search when using visual
          hapticService.scanSuccess();
        } else {
          Alert.alert("Visual AI", "Could not identify the item. Please try a different angle or manual search.");
        }
      }
    } catch (error) {
      console.error("Visual search error:", error);
      Alert.alert("Visual AI Error", "Failed to process image for identification.");
    } finally {
      setIsAISearching(false);
      setLoading(false);
    }
  };

  // Effect for live search
  useEffect(() => {
    if (debouncedSearchQuery) {
      handleSearch(debouncedSearchQuery);
    } else {
      setSearchResults([]);
      setShowResults(false);
    }
  }, [debouncedSearchQuery, handleSearch]);

  const loadRecentItems = async () => {
    try {
      const recent = await RecentItemsService.getRecent();
      setRecentItems(recent.slice(0, 5)); // Get first 5 items
    } catch (error) {
      console.error("Failed to load recent items:", error);
    }
  };

  const quickActionsStyle = useAnimatedStyle(() => ({
    transform: [{ scale: quickActionsScale.value }],
    opacity: quickActionsScale.value,
  }));

  const toggleQuickActions = () => {
    hapticService.impact("medium");

    if (showQuickActions) {
      quickActionsScale.value = withTiming(0, { duration: 200 });
      setTimeout(() => setShowQuickActions(false), 200);
    } else {
      setShowQuickActions(true);
      quickActionsScale.value = withSpring(1);
    }
  };

  const handleScanPress = () => {
    hapticService.impact("heavy");

    if (!permission?.granted) {
      requestPermission();
      return;
    }
    setScanned(false); // Reset scanned state when opening camera
    scanBufferRef.current = []; // Clear scan buffer for fresh start
    setIsScanning(true);
  };

  const handleBarcodeScan = async ({ data }: { data: string }) => {
    if (scanned) return; // Prevent multiple scans

    const now = Date.now();
    const trimmedData = data.trim();

    // Clean old entries from buffer (older than timeout)
    scanBufferRef.current = scanBufferRef.current.filter(
      (entry) => now - entry.timestamp < SCAN_BUFFER_TIMEOUT
    );

    // Find existing entry for this barcode
    const existingIndex = scanBufferRef.current.findIndex(
      (entry) => entry.code === trimmedData
    );

    if (existingIndex >= 0 && scanBufferRef.current[existingIndex]) {
      // Increment count for existing barcode
      scanBufferRef.current[existingIndex]!.count += 1;
      scanBufferRef.current[existingIndex]!.timestamp = now;
    } else {
      // Add new barcode to buffer
      scanBufferRef.current.push({
        code: trimmedData,
        count: 1,
        timestamp: now,
      });

      // Keep buffer size manageable
      if (scanBufferRef.current.length > SCAN_BUFFER_MAX_SIZE) {
        scanBufferRef.current.shift();
      }
    }

    // Find the barcode with highest confidence (most reads)
    const confident = scanBufferRef.current.find(
      (entry) => entry.count >= SCAN_CONFIDENCE_THRESHOLD
    );

    // Only proceed if we have confident read
    if (!confident) {
      // Light haptic to indicate scan detected but not yet confirmed
      hapticService.impact("light");
      return;
    }

    // We have a confident scan - proceed
    setScanned(true);
    scanBufferRef.current = []; // Clear buffer after successful scan

    hapticService.scanSuccess();

    // Deduplication check
    const { isDuplicate } = scanDeduplicationService.checkDuplicate(confident.code);
    if (isDuplicate) {
      hapticService.notification("warning");
      // Show visual feedback for duplicate
      setScanFeedbackType("duplicate");
      setScanFeedbackMessage("This item was recently scanned");
      setShowScanFeedback(true);
    }

    setIsScanning(false);
    await handleLookup(confident.code);
  };

  const handleLookup = async (barcode: string) => {
    // Validate barcode with detailed error message
    const validation = validateBarcode(barcode);
    if (!validation.valid) {
      hapticService.scanError();
      // Show user-friendly error in scan feedback
      setScanFeedbackType("error");
      setScanFeedbackMessage(validation.error || "Invalid barcode");
      setShowScanFeedback(true);
      return;
    }

    const sanitized = validation.value!;
    setLoading(true);
    setSearchQuery(""); // Clear search query on lookup
    setShowResults(false); // Hide results

    try {
      let item: any;
      try {
        // Always use the API layer lookup: it already handles offline cache fallback.
        item = await getItemByBarcode(sanitized);
      } catch (e) {
        // As a last resort, try sqlite local DB (if present).
        try {
          console.log("Lookup failed, trying local DB fallback...");
          item = await localDb.getItemByBarcode(sanitized);
        } catch {
          throw e;
        }
      }

      if (item) {
        hapticService.scanSuccess();

        // Show success feedback
        setScanFeedbackType("success");
        setScanFeedbackMessage(`Found: ${item.item_name || item.item_code}`);
        setShowScanFeedback(true);

        // Track recent
        console.log("Adding to recent items service...");
        try {
          await RecentItemsService.addRecent(item.item_code, item);
          console.log("Added to recent items.");
        } catch (e) {
          console.error("Failed to add recent item:", e);
        }
        await loadRecentItems();

        // Navigate to detail
        console.log("Navigating to item detail with:", {
          barcode: item.item_code,
          sessionId,
        });
        router.push({
          pathname: "/staff/item-detail",
          params: { barcode: item.item_code, sessionId: sessionId as string },
        } as any);
      } else {
        hapticService.scanError();
        // Show error feedback
        setScanFeedbackType("error");
        setScanFeedbackMessage(`Item not found: ${barcode}`);
        setShowScanFeedback(true);
      }
    } catch (error: any) {
      hapticService.scanError();
      // Prefer inline feedback instead of a modal to avoid interrupting scanning.
      setScanFeedbackType("error");
      setScanFeedbackMessage(error?.message || "Failed to lookup item");
      setShowScanFeedback(true);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSearch = () => {
    if (searchQuery.trim()) {
      // Only trigger direct lookup if it looks like a barcode (starts with 51, 52, 53)
      // Otherwise, just let the search results stay (don't auto-select)
      if (searchQuery.startsWith("51") || searchQuery.startsWith("52") || searchQuery.startsWith("53")) {
        handleLookup(searchQuery);
      } else {
        // Ensure results are shown (they should be from debounce)
        Keyboard.dismiss();
      }
    }
  };

  const handleSearchResultPress = async (item: any) => {
    const code = item.barcode || item.item_code;
    if (!code) return;
    // Keep results visible until lookup finishes to avoid layout jump at the bottom
    await handleLookup(code);
    requestAnimationFrame(() => setShowResults(false));
  };

  const handleRecentItemPress = (item: any) => {
    const code = item.barcode || item.item_code;
    if (code) {
      handleLookup(code);
    }
  };

  const _handleLogout = () => {
    hapticService.impact("medium");
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: logout,
      },
    ]);
  };

  const [isFinishing, setIsFinishing] = useState(false);

  const handleFinishRack = () => {
    hapticService.impact("medium");
    Alert.alert(
      "Finish Rack",
      "Are you sure you want to mark this rack as complete? You won't be able to add more items to this section.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Finish Rack",
          style: "default",
          onPress: async () => {
            if (!sessionId) {
              Alert.alert("Error", "No active session to close.");
              return;
            }
            setIsFinishing(true);
            try {
              await updateSessionStatus(sessionId, "closed");
              hapticService.notification("success");
              Alert.alert("Success", "Rack marked as complete!", [
                {
                  text: "OK",
                  onPress: () => router.replace("/staff/home"),
                },
              ]);
            } catch (error: any) {
              console.error("Failed to finish rack:", error);
              Alert.alert("Error", error.message || "Failed to close session.");
            } finally {
              setIsFinishing(false);
            }
          },
        },
      ],
    );
  };

  if (isScanning) {
    return (
      <View style={styles.cameraFullScreen}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          onBarcodeScanned={scanned ? undefined : handleBarcodeScan}
          barcodeScannerSettings={{
            barcodeTypes: [
              // 1D Barcodes - Full support
              "ean13",
              "ean8",
              "upc_a",
              "upc_e",
              "code128",
              "code39",
              "code93",
              "codabar",
              "itf14",
              // 2D Codes
              "qr",
            ],
          }}
        >
          {/* AR-style overlay */}
          <View style={styles.cameraOverlay}>
            <View style={[styles.scanFrame, { width: width * 0.7, height: width * 0.7 }]}>
              <View style={[styles.corner, styles.cornerTopLeft, { borderColor: colors.accent }]} />
              <View style={[styles.corner, styles.cornerTopRight, { borderColor: colors.accent }]} />
              <View style={[styles.corner, styles.cornerBottomLeft, { borderColor: colors.accent }]} />
              <View style={[styles.corner, styles.cornerBottomRight, { borderColor: colors.accent }]} />
            </View>

            <Text style={[styles.scanInstructions, { color: "#FFFFFF" }]}>
              Position barcode within the frame
            </Text>

            {/* Visual Identification Button */}
            <TouchableOpacity
              style={styles.photoIdentifyButton}
              onPress={handleVisualSearch}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={["rgba(14, 165, 233, 0.8)", "rgba(2, 132, 199, 0.9)"]}
                style={styles.photoIdentifyGradient}
              >
                <Ionicons name="camera" size={20} color="#FFF" />
                <Text style={styles.photoIdentifyText}>Identify Item (AI)</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Cancel button */}
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setIsScanning(false)}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={["rgba(15, 23, 42, 0.8)", "rgba(2, 6, 23, 0.9)"]}
                style={styles.cancelButtonGradient}
              >
                <Ionicons name="close" size={24} color="#FFF" />
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  return (
    <ScreenContainer
      header={{
        title: "Scan Items",
        subtitle:
          sessionType !== "STANDARD"
            ? `Session: ${sessionId || "None"} • ${sessionType}`
            : `Session: ${sessionId || "None"}`,
        showBackButton: true,
        showUsername: false,
        showLogoutButton: true,
        customRightContent: <SyncStatusPill />,
      }}
      backgroundType="aurora"
      auroraVariant="primary"
      auroraIntensity="medium"
      contentMode="static"
      noPadding
      statusBarStyle="light"
      overlay={
        <>
          <OfflineIndicator />
          <ScanFeedback
            visible={showScanFeedback}
            type={scanFeedbackType}
            title={scanFeedbackMessage}
            onDismiss={() => setShowScanFeedback(false)}
            duration={2000}
          />
        </>
      }
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Search Card */}
        <Animated.View entering={FadeInDown.delay(100).springify()}>
          <GlassCard
            variant="medium"
            intensity={20}
            elevation="md"
            style={styles.searchCard}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]}>Quick Search</Text>
            <View style={[styles.searchInputContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons
                name="search"
                size={20}
                color={colors.textSecondary}
                style={styles.searchIcon}
              />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Enter barcode or item name..."
                placeholderTextColor={colors.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleManualSearch}
                returnKeyType="search"
              />
              <View style={styles.searchActions}>
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      setSearchQuery("");
                      setSearchResults([]);
                      setShowResults(false);
                      setSearchMethod("standard");
                    }}
                    style={styles.clearButton}
                  >
                    <Ionicons
                      name="close-circle"
                      size={20}
                      color={colors.muted}
                    />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setIsScanning(true)}
                  style={styles.aiButton}
                >
                  <Ionicons
                    name="camera-outline"
                    size={20}
                    color={colors.accent}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Live Search Results */}
            {showResults && (
              <View style={[styles.searchResultsContainer, { borderTopColor: colors.border }]}>
                {isSearching ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.accent}
                    style={{ padding: 10 }}
                  />
                ) : searchResults.length > 0 ? (
                  <ScrollView
                    style={styles.resultsList}
                    contentContainerStyle={styles.resultsListContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                  >
                    {searchResults.map((item, index) => (
                      <TouchableOpacity
                        key={`${item.barcode || item.item_code || item.id}-${index}`}
                        style={[styles.resultItem, { borderBottomColor: colors.border }]}
                        onPress={() => handleSearchResultPress(item)}
                      >
                        <View style={[styles.resultIcon, { backgroundColor: colors.surfaceElevated }]}>
                          <Ionicons
                            name="cube-outline"
                            size={18}
                            color={colors.textSecondary}
                          />
                        </View>
                        <View style={styles.resultInfo}>
                          <Text style={[styles.resultName, { color: colors.text }]} numberOfLines={1}>
                            {item.item_name || item.name}
                          </Text>
                          <View style={styles.resultCodeRow}>
                            <Text style={[styles.resultCode, { color: colors.textSecondary }]}>
                              {item.barcode || item.item_code || "—"}
                            </Text>
                            {item.mrp != null && item.mrp > 0 && (
                              <View style={[styles.mrpBadge, { backgroundColor: colors.warning + '15', borderColor: colors.warning + '30' }]}>
                                <Text style={[styles.mrpBadgeText, { color: colors.warning }]}>₹{item.mrp}</Text>
                              </View>
                            )}
                            {item.batch_id && (
                              <View style={[styles.batchBadge, { backgroundColor: colors.accent + '10', borderColor: colors.accent + '20' }]}>
                                <Text style={[styles.batchBadgeText, { color: colors.accent }]}>Batch: {item.batch_id}</Text>
                              </View>
                            )}
                          </View>
                          {(item.manual_barcode || item.unit2_barcode || item.unit_m_barcode) && (
                            <View style={styles.altBarcodesRow}>
                              {item.manual_barcode && (
                                <View style={[styles.otherBarcodeBadge, { backgroundColor: colors.success + '10', borderColor: colors.success + '20' }]}>
                                  <Text style={[styles.otherBarcodeText, { color: colors.success }]}>Manual: {item.manual_barcode}</Text>
                                </View>
                              )}
                              {item.unit2_barcode && (
                                <View style={[styles.otherBarcodeBadge, { backgroundColor: colors.success + '10', borderColor: colors.success + '20' }]}>
                                  <Text style={[styles.otherBarcodeText, { color: colors.success }]}>Unit2: {item.unit2_barcode}</Text>
                                </View>
                              )}
                              {item.unit_m_barcode && (
                                <View style={[styles.otherBarcodeBadge, { backgroundColor: colors.success + '10', borderColor: colors.success + '20' }]}>
                                  <Text style={[styles.otherBarcodeText, { color: colors.success }]}>UnitM: {item.unit_m_barcode}</Text>
                                </View>
                              )}
                            </View>
                          )}
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={colors.muted}
                        />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  debouncedSearchQuery.length >= 2 && (
                    <View style={styles.semanticSearchContainer}>
                      <Text style={[styles.noResultsText, { color: colors.textSecondary }]}>No direct matches found</Text>
                      <TouchableOpacity
                        style={[styles.semanticSearchButton, { borderColor: colors.accent + '30', backgroundColor: colors.accent + '05' }]}
                        onPress={handleSemanticSearch}
                        disabled={isAISearching}
                      >
                        {isAISearching ? (
                          <ActivityIndicator size="small" color={colors.accent} />
                        ) : (
                          <>
                            <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
                            <Text style={[styles.semanticSearchText, { color: colors.accent }]}>Search by meaning (AI)</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  )
                )}
              </View>
            )}
          </GlassCard>
        </Animated.View>

        {/* Recent Items */}
        {recentItems.length > 0 && (
          <Animated.View entering={FadeInUp.delay(200).springify()}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Items</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.recentItemsContainer}
            >
              {recentItems.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => handleRecentItemPress(item)}
                  activeOpacity={0.7}
                >
                  <GlassCard
                    variant="light"
                    intensity={15}
                    elevation="sm"
                    padding={16}
                    style={styles.recentItemCard}
                  >
                    <View style={[styles.recentItemIcon, { backgroundColor: colors.accent + '15' }]}>
                      <Ionicons
                        name="cube-outline"
                        size={24}
                        color={colors.accent}
                      />
                    </View>
                    <View style={styles.resultCodeRow}>
                      <Text style={[styles.recentItemCode, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.item_code}
                      </Text>
                      {item.batch_id && (
                        <View style={[styles.batchBadge, { backgroundColor: colors.accent + '10', borderColor: colors.accent + '20' }]}>
                          <Text style={[styles.batchBadgeText, { color: colors.accent }]}>B</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.recentItemName, { color: colors.text }]} numberOfLines={2}>
                      {item.item_name || "Unknown Item"}
                    </Text>
                  </GlassCard>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Stats Card */}
        <Animated.View entering={FadeInUp.delay(300).springify()}>
          <GlassCard
            variant="medium"
            intensity={20}
            elevation="md"
            style={styles.statsCard}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]}>Today&apos;s Progress</Text>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.text }]}>0</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Scanned</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.text }]}>0</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Verified</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.text }]}>0</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Pending</Text>
              </View>
            </View>
          </GlassCard>
        </Animated.View>

        {/* Finish Rack Button */}
        <Animated.View entering={FadeInUp.delay(400).springify()}>
          <TouchableOpacity
            style={[
              styles.finishRackButton,
              isFinishing && styles.finishRackButtonDisabled,
            ]}
            onPress={handleFinishRack}
            disabled={isFinishing}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[...appTheme.gradients.success]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.finishRackGradient}
            >
              {isFinishing ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={24} color="#FFF" />
                  <Text style={styles.finishRackText}>Finish Rack</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>

        {/* Spacing for floating button */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Floating Scan Button */}
      <View style={styles.floatingButtonContainer}>
        <FloatingScanButton onPress={handleScanPress} disabled={loading} />
      </View>

      {/* Quick Actions Menu */}
      {showQuickActions && (
        <Animated.View
          style={[styles.quickActionsContainer, quickActionsStyle]}
        >
          <TouchableOpacity
            style={styles.quickActionButton}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={[...appTheme.gradients.accent]}
              style={styles.quickActionGradient}
            >
              <Ionicons
                name="list"
                size={24}
                color="#FFF"
              />
            </LinearGradient>
            <Text style={[styles.quickActionLabel, { color: colors.text }]}>History</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionButton}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={[...appTheme.gradients.success]}
              style={styles.quickActionGradient}
            >
              <Ionicons
                name="checkmark-done"
                size={24}
                color="#FFF"
              />
            </LinearGradient>
            <Text style={[styles.quickActionLabel, { color: colors.text }]}>Verify</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Quick Actions Toggle */}
      <TouchableOpacity
        style={styles.quickActionsToggle}
        onPress={toggleQuickActions}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={[...appTheme.gradients.accent]}
          style={styles.quickActionsToggleGradient}
        >
          <Ionicons
            name={showQuickActions ? "close" : "apps"}
            size={24}
            color="#FFF"
          />
        </LinearGradient>
      </TouchableOpacity>
    </ScreenContainer >
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 16,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.text.primary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    marginTop: 2,
  },
  headerSubtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  modeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  modeBadgeBlind: {
    backgroundColor: "#F59E0B",
  },
  modeBadgeStrict: {
    backgroundColor: "#EF4444",
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#FFF",
  },
  logoutButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  searchCard: {
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.text.primary,
    marginBottom: 16,
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.background.paper,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text.primary,
  },
  clearButton: {
    padding: 4,
  },
  searchActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  aiButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: theme.colors.gradients.shimmer[0],
  },
  semanticSearchContainer: {
    padding: 12,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
  },
  semanticSearchButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: theme.colors.gradients.shimmer[0],
    borderWidth: 1,
    borderColor: theme.colors.primary[200],
  },
  semanticSearchText: {
    color: theme.colors.primary[500],
    fontSize: 13,
    fontWeight: "600",
  },
  photoIdentifyButton: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    borderRadius: 20,
    overflow: "hidden",
  },
  photoIdentifyGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  photoIdentifyText: {
    color: theme.colors.text.inverse,
    fontSize: 15,
    fontWeight: "600",
  },
  // Search Results Styles
  searchResultsContainer: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
    paddingTop: 5,
  },
  resultsList: {
    maxHeight: 200,
  },
  resultsListContent: {
    paddingBottom: 4,
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  resultIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.colors.gradients.shimmer[0],
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    color: theme.colors.text.primary,
    fontSize: 14,
    fontWeight: "500",
  },
  resultCode: {
    color: theme.colors.text.secondary,
    fontSize: 12,
  },
  noResultsText: {
    color: theme.colors.text.tertiary,
    fontSize: 13,
    textAlign: "center",
    padding: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.text.primary,
    marginBottom: 16,
  },
  recentItemsContainer: {
    paddingBottom: 16,
    gap: 16,
  },
  recentItemCard: {
    width: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  recentItemIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  recentItemCode: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.text.primary,
    marginBottom: 4,
  },
  recentItemName: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    textAlign: "center",
  },
  statsCard: {
    marginTop: 20,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
  },
  statValue: {
    fontSize: 30,
    fontWeight: "700",
    color: "#0EA5E9",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: theme.colors.text.secondary,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  floatingButtonContainer: {
    position: "absolute",
    bottom: 32,
    alignSelf: "center",
  },
  quickActionsContainer: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    flexDirection: "row",
    gap: 16,
  },
  quickActionButton: {
    alignItems: "center",
    gap: 4,
  },
  quickActionGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  quickActionLabel: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    fontWeight: "500",
  },
  quickActionsToggle: {
    position: "absolute",
    bottom: 32,
    right: 24,
  },
  quickActionsToggleGradient: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  // Camera styles
  cameraFullScreen: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 40,
    height: 40,
    borderColor: "#0EA5E9",
    borderWidth: 3,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 8,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 8,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 8,
  },
  scanInstructions: {
    fontSize: 16,
    color: theme.colors.text.primary,
    marginTop: 32,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  cancelButton: {
    position: "absolute",
    bottom: 60,
    borderRadius: 30,
    overflow: "hidden",
  },
  cancelButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.text.primary,
  },
  // Finish Rack Button Styles
  finishRackButton: {
    marginTop: 16,
    marginHorizontal: 20,
    borderRadius: 12,
    overflow: "hidden",
  },
  finishRackButtonDisabled: {
    opacity: 0.7,
  },
  finishRackGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  finishRackText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
  resultCodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  batchBadge: {
    backgroundColor: "rgba(14, 165, 233, 0.1)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(14, 165, 233, 0.2)",
  },
  batchBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#0EA5E9",
  },
  mrpBadge: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  mrpBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#F59E0B",
  },
  altBarcodesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  otherBarcodeBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
  },
  otherBarcodeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#10B981",
  },
});
