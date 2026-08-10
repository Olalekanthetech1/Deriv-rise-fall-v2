import type { ReactNode } from 'react';
import { AdminIntegrityGuard } from '@/components/admin/admin-integrity-guard';
import { AdminThemeProvider } from '@/components/admin/admin-theme-provider';
import AdminMlDiagnostics from '@/components/admin/admin-ml-diagnostics';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminIntegrityGuard>
      <AdminThemeProvider>
        <AdminMlDiagnostics>{children}</AdminMlDiagnostics>
      </AdminThemeProvider>
    </AdminIntegrityGuard>
  );
}
