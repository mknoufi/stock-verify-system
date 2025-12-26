import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { PinEntryModal } from "../../src/components/modals/PinEntryModal";
import { useAuthStore } from "../../src/store/authStore";
import { deleteCountLine, getCountLines } from "../../src/services/api/api";
import { haptics } from "../../src/services/utils/haptics";
import { flags } from "../../src/constants/flags";
import { PullToRefresh } from "../../src/components/PullToRefresh";
import { BottomSheet } from "../../src/components/ui/BottomSheet";
import { SkeletonList } from "../../src/components/LoadingSkeleton";
import { SwipeableRow } from "../../src/components/SwipeableRow";
import Animated, { FadeInUp } from "react-native-reanimated";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { theme } from "../../src/styles/modernDesignSystem";
import { ScreenContainer } from "../../src/components/ui";

export default function HistoryScreen() {
  const params = useLocalSearchParams();
  const sessionId = params.sessionId as string | undefined;
  const initialApproved =
    flags.enableDeepLinks &&
    (params.approved === "1" || params.approved === "true");
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  interface CountLine {
    id: string;
    item_code: string;
    batch_id?: string;
    item_name: string;
    erp_qty: number;
    counted_qty: number;
    variance: number;
    variance_reason?: string;
    remark?: string;
    status: string;
    counted_at: string;
  }
  const [countLines, setCountLines] = React.useState<CountLine[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [showApprovedOnly, setShowApprovedOnly] =
    React.useState<boolean>(!!initialApproved);

  // Pin Entry Modal State
  const [pinModalVisible, setPinModalVisible] = React.useState(false);
  const [selectedLineForDelete, setSelectedLineForDelete] =
    React.useState<CountLine | null>(null);

  const loadCountLines = React.useCallback(async () => {
    try {
      const data = await getCountLines(sessionId as string);
      const safeData = Array.isArray(data) ? data : [];
      setCountLines(
        showApprovedOnly
          ? safeData.filter((d: any) => d.status === "approved")
          : safeData,
      );
      if (safeData.length && flags.enableHaptics) {
        haptics.success();
      }
    } catch (error) {
      console.error("Load count lines error:", error);
      if (flags.enableHaptics) haptics.error();
    } finally {
      setLoading(false);
    }
  }, [sessionId, showApprovedOnly]);

  React.useEffect(() => {
    loadCountLines();
  }, [loadCountLines]);

  // Keep state in sync if URL param changes (e.g., deep link navigation)
  React.useEffect(() => {
    if (!flags.enableDeepLinks) return;
    const approvedParam = params.approved === "1" || params.approved === "true";
    if (approvedParam !== showApprovedOnly) {
      setShowApprovedOnly(approvedParam);
      // Reload to reflect the new filter
      loadCountLines();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.approved]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await loadCountLines();
    } finally {
      setRefreshing(false);
    }
  }, [loadCountLines]);

  // Keyboard shortcuts (web): r = refresh, f = filters
  React.useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") {
        onRefresh();
      }
      if (e.key === "f" || e.key === "F") {
        setFiltersOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRefresh]);

  const handleDeleteRequest = (item: CountLine) => {
    setSelectedLineForDelete(item);
    setPinModalVisible(true);
  };

  const handlePinSuccess = async () => {
    if (!selectedLineForDelete) return;

    try {
      await deleteCountLine(selectedLineForDelete.id);
      if (flags.enableHaptics) haptics.success();
      Alert.alert("Success", "Count line deleted successfully");
      loadCountLines(); // Refresh list
    } catch (error: any) {
      console.error("Delete error:", error);
      Alert.alert(
        "Error",
        error.response?.data?.detail || "Failed to delete count line",
      );
      if (flags.enableHaptics) haptics.error();
    } finally {
      setSelectedLineForDelete(null);
    }
  };

  const renderCountLine = ({
    item,
    index,
  }: {
    item: CountLine;
    index: number;
  }) => {
    const varianceColor = item.variance === 0 ? "#10B981" : "#EF4444";
    const statusColor =
      item.status === "approved"
        ? "#10B981"
        : item.status === "rejected"
          ? "#EF4444"
          : "#F59E0B";

    const CardContent = (
      <GlassCard variant="medium" style={styles.countCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.itemName}>
            {item.item_name || "Unknown Item"}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>
              {(item.status || "pending").toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.codeRow}>
          <Text style={styles.itemCode}>Code: {item.item_code || "N/A"}</Text>
          {item.batch_id && (
            <View style={styles.batchBadge}>
              <Text style={styles.batchBadgeText}>Batch: {item.batch_id}</Text>
            </View>
          )}
        </View>

        <View style={styles.qtyRow}>
          <View style={styles.qtyItem}>
            <Text style={styles.qtyLabel}>ERP</Text>
            <Text style={styles.qtyValue}>{item.erp_qty ?? 0}</Text>
          </View>
          <View style={styles.qtyItem}>
            <Text style={styles.qtyLabel}>Counted</Text>
            <Text style={styles.qtyValue}>{item.counted_qty ?? 0}</Text>
          </View>
          <View style={styles.qtyItem}>
            <Text style={styles.qtyLabel}>Variance</Text>
            <Text style={[styles.qtyValue, { color: varianceColor }]}>
              {item.variance ?? 0}
            </Text>
          </View>
        </View>

        {item.variance_reason && (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonLabel}>Reason:</Text>
            <Text style={styles.reasonText}>{item.variance_reason}</Text>
          </View>
        )}

        {item.remark && (
          <Text style={styles.remark}>Remark: {item.remark}</Text>
        )}

        <Text style={styles.timestamp}>
          {new Date(item.counted_at).toLocaleString()}
        </Text>
      </GlassCard>
    );

    const AnimatedCard = flags.enableAnimations ? (
      <Animated.View
        entering={FadeInUp.delay(index * 50)
          .springify()
          .damping(12)}
      >
        {CardContent}
      </Animated.View>
    ) : (
      CardContent
    );

    if (flags.enableSwipeActions && Platform.OS !== "web") {
      return (
        <SwipeableRow
          leftLabel="Details"
          rightLabel="Delete"
          onLeftAction={() => {
            if (flags.enableHaptics) haptics.light?.();
            router.push({
              pathname: "/supervisor/session/[id]",
              params: { id: sessionId as string },
            });
          }}
          onRightAction={() => {
            if (flags.enableHaptics) haptics.selection?.();
            handleDeleteRequest(item);
          }}
        >
          {AnimatedCard}
        </SwipeableRow>
      );
    }

    return AnimatedCard;
  };

  return (
    <ScreenContainer
      backgroundType="aurora"
      auroraVariant="primary"
      header={{
        title: "Count History",
        showBackButton: true,
        showUsername: false,
        showLogoutButton: true,
        rightAction: {
          icon: "options-outline",
          label: "Filters",
          onPress: () => setFiltersOpen(true),
        },
      }}
      contentMode="static"
      noPadding
      statusBarStyle="light"
    >
      {loading && !refreshing ? (
        <View style={{ padding: 16 }}>
          <SkeletonList itemHeight={120} count={6} />
        </View>
      ) : (
        <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
          <FlashList
            data={countLines}
            renderItem={renderCountLine}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="file-tray-outline" size={64} color={theme.colors.text.tertiary} />
                <Text style={styles.emptyText}>
                  {loading ? "Loading..." : "No counts yet"}
                </Text>
              </View>
            }
          />
        </PullToRefresh>
      )}

      <BottomSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        height={260}
      >
        <Text style={styles.filterTitle}>Filters</Text>
        <TouchableOpacity
          style={[styles.filterChip, showApprovedOnly && styles.filterChipActive]}
          onPress={() => {
            const next = !showApprovedOnly;
            setShowApprovedOnly(next);
            setFiltersOpen(false);
            if (flags.enableDeepLinks) {
              router.replace({
                pathname: "/staff/history",
                params: { sessionId, approved: next ? "1" : undefined },
              });
            }
            loadCountLines();
          }}
        >
          <Ionicons
            name="checkmark-done-outline"
            size={18}
            color={showApprovedOnly ? "#020617" : theme.colors.text.tertiary}
          />
          <Text
            style={[
              styles.filterChipText,
              showApprovedOnly && styles.filterChipTextActive,
            ]}
          >
            Approved Only
          </Text>
        </TouchableOpacity>
      </BottomSheet>

      <PinEntryModal
        visible={pinModalVisible}
        onClose={() => {
          setPinModalVisible(false);
          setSelectedLineForDelete(null);
        }}
        onSuccess={handlePinSuccess}
        action="delete_count_line"
        staffUsername={user?.username || "unknown"}
        entityId={selectedLineForDelete?.id}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    paddingTop: 60,
    backgroundColor: "transparent",
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.text.primary,
  },
  list: {
    padding: 16,
  },
  filterTitle: {
    color: theme.colors.text.primary,
    fontWeight: "700",
    fontSize: 18,
    marginBottom: 16,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignSelf: "flex-start",
  },
  filterChipActive: {
    backgroundColor: "#10B981",
    borderColor: "#10B981",
  },
  filterChipText: {
    color: theme.colors.text.secondary,
    fontWeight: "600",
  },
  filterChipTextActive: {
    color: "#020617",
  },
  countCard: {
    marginBottom: 16,
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  itemName: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.text.primary,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    color: "#020617",
    fontSize: 10,
    fontWeight: "700",
  },
  itemCode: {
    fontSize: 12,
    color: theme.colors.text.secondary,
  },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  batchBadge: {
    backgroundColor: "rgba(14, 165, 233, 0.1)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(14, 165, 233, 0.2)",
  },
  batchBadgeText: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#0EA5E9",
  },
  qtyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  qtyItem: {
    flex: 1,
    alignItems: "center",
  },
  qtyLabel: {
    fontSize: 12,
    color: theme.colors.text.tertiary,
    marginBottom: 4,
  },
  qtyValue: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.text.primary,
  },
  reasonBox: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  reasonLabel: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    marginBottom: 4,
  },
  reasonText: {
    fontSize: 14,
    color: "#F59E0B",
    fontWeight: "700",
  },
  remark: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    fontStyle: "italic",
    marginBottom: 8,
  },
  timestamp: {
    fontSize: 12,
    color: theme.colors.text.tertiary,
    textAlign: "right",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
  },
  emptyText: {
    color: theme.colors.text.secondary,
    fontSize: 16,
    marginTop: 16,
  },
});
