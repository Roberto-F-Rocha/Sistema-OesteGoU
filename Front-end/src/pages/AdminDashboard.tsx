import { Routes, Route, Navigate } from "react-router-dom";
import {
  Activity,
  Bell,
  Bus,
  Calendar,
  Clock,
  FileText,
  GraduationCap,
  LayoutDashboard,
  MapPin,
  School,
  Truck,
  Link2,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import AdminOverview from "./admin/AdminOverview";
import AdminStudents from "./admin/AdminStudents";
import AdminDrivers from "./admin/AdminDrivers";
import AdminSchedules from "./admin/AdminSchedules";
import AdminFleet from "./admin/AdminFleet";
import AdminUniversities from "./admin/AdminUniversities";
import AdminShifts from "./admin/AdminShifts";
import AdminPickupPoints from "./admin/AdminPickupPoints";
import AdminDocuments from "./admin/AdminDocuments";
import AdminPush from "./admin/AdminPush";
import AdminPartnerships from "./admin/AdminPartnerships";
import AdminAnalytics from "./admin/AdminAnalytics";

export default function AdminDashboard() {
  const { user } = useAuth();
  const adminCity = user?.city?.name ?? "Riacho da Cruz";
  const adminState = user?.city?.state ?? "RN";

  const navItems = [
    { label: "Painel", path: "/admin", icon: LayoutDashboard },
    { label: "Analytics", path: "/admin/analytics", icon: Activity },
    { label: "Parcerias", path: "/admin/parcerias", icon: Link2 },
    { label: "Alunos", path: "/admin/alunos", icon: GraduationCap },
    { label: "Motoristas", path: "/admin/motoristas", icon: Truck },
    { label: "Frota", path: "/admin/frota", icon: Bus },
    { label: "Horários", path: "/admin/horarios", icon: Calendar },
    { label: "Turnos", path: "/admin/turnos", icon: Clock },
    { label: "Universidades", path: "/admin/universidade", icon: School },
    { label: "Pontos", path: "/admin/pontos", icon: MapPin },
    { label: "Documentos", path: "/admin/documentos", icon: FileText },
    { label: "Notificação", path: "/admin/push", icon: Bell },
  ];

  return (
    <DashboardLayout navItems={navItems} title={`Administração · ${adminCity}`}>
      <Routes>
        <Route index element={<AdminOverview adminCity={adminCity} adminState={adminState} />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="parcerias" element={<AdminPartnerships />} />
        <Route path="alunos" element={<AdminStudents adminCity={adminCity} adminState={adminState} />} />
        <Route path="motoristas" element={<AdminDrivers adminCity={adminCity} adminState={adminState} />} />
        <Route path="frota" element={<AdminFleet adminCity={adminCity} adminState={adminState} />} />
        <Route path="horarios" element={<AdminSchedules adminCity={adminCity} adminState={adminState} />} />
        <Route path="turnos" element={<AdminShifts adminCity={adminCity} adminState={adminState} />} />
        <Route path="universidade" element={<AdminUniversities adminCity={adminCity} adminState={adminState} />} />
        <Route path="pontos" element={<AdminPickupPoints adminCity={adminCity} adminState={adminState} />} />
        <Route path="documentos" element={<AdminDocuments />} />
        <Route path="push" element={<AdminPush />} />
        <Route path="bi" element={<Navigate to="/admin/analytics" replace />} />
        <Route path="universidades" element={<Navigate to="/admin/universidade" replace />} />
        <Route path="escalas" element={<Navigate to="/admin/horarios" replace />} />
        <Route path="pontos-embarque" element={<Navigate to="/admin/pontos" replace />} />
        <Route path="docs" element={<Navigate to="/admin/documentos" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </DashboardLayout>
  );
}
