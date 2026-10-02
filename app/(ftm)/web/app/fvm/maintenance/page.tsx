"use client";

import GlobalFooter from "../../components/GlobalFooter";
import GlobalNavbar from "../../components/GlobalNavbar";
import RoleRestricted from "../../components/RoleRestricted";
import MaintenanceCalendarDashboard from "./MaintenanceCalendarDashboard";

export default function FvmMaintenancePage() {
  return (
    <RoleRestricted allowedRoles={["fleet_manager", "admin"]} hideWhenRestricted>
      <div className="flex min-h-screen flex-col bg-[#fff8fc] text-slate-800">
        <GlobalNavbar />
        <MaintenanceCalendarDashboard />
        <GlobalFooter />
      </div>
    </RoleRestricted>
  );
}