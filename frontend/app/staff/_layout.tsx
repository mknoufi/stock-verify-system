/**
 * Staff Layout - Navigation structure for staff role
 * Features:
 * - Stack-based navigation optimized for scanning workflow
 * - Quick access to scan and history
 * - Session status indicator
 */

import React from "react";
import { Stack, useRouter } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";

export default function StaffLayout() {
  const router = useRouter();
  const { user } = useAuthStore();

  // Redirect if not authenticated
  React.useEffect(() => {
    if (!user) {
      router.replace("/login");
    }
  }, [user, router]);

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}

