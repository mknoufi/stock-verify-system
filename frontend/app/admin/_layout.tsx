/**
 * Admin Layout - Navigation structure for admin role
 * Features:
 * - Web/Tablet: Sidebar + Stack navigation (AdminSidebar)
 * - Mobile: Stack-based navigation with Aurora design
 * - Custom header with back button and logout
 * - Role-based access protection
 */

import React, { useState } from "react";
import { Stack, useRouter, Slot } from "expo-router";
import {
  View,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from "react-native";
import { auroraTheme } from "../../src/theme/auroraTheme";
import { useAuthStore } from "../../src/store/authStore";
import { AdminSidebar } from "../../src/components/navigation";

export default function AdminLayout() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 1024 && Platform.OS === "web";
  const { user } = useAuthStore();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Redirect non-admin users
  React.useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/login");
    }
  }, [user, router]);


  // Web/Tablet: Use sidebar layout
  if (isLargeScreen) {
    return (
      <View style={styles.webContainer}>
        <AdminSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <View style={styles.mainContent}>
          <Slot />
        </View>
      </View>
    );
  }

  // Mobile: Use stack navigation
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}

const styles = StyleSheet.create({
  webContainer: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: auroraTheme.colors.background.primary,
  },
  mainContent: {
    flex: 1,
    backgroundColor: auroraTheme.colors.background.primary,
  },
});
