import type { ReactNode } from 'react';
import { AdminIntegrityGuard } from '@/components/admin/admin-integrity-guard';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminIntegrityGuard>{children}</AdminIntegrityGuard>;
}
