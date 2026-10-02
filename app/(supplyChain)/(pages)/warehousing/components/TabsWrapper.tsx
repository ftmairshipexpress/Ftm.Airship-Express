"use client";
import { useEffect, useState, useCallback, ReactNode, Children, isValidElement } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { NavBtn } from '../../../components/global/Buttons';
import { useUserRole } from "../../../components/global/UnauthorizedEmptyState";

interface TabsWrapperProps {
    children: ReactNode;
}
interface PanelProps {
    'data-panel'?: string;
    className?: string;
    children?: ReactNode;
}

export default function TabsWrapper({ children }: TabsWrapperProps) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { isPrivileged, isLoaded } = useUserRole();
    const [activeTab, setActiveTab] = useState<string>('dashboard');

    const getTabFromUrl = useCallback(() => {
        const tab = searchParams.get('tab');
        if (tab) return tab;
        return isPrivileged ? 'dashboard' : 'incoming';
    }, [searchParams, isPrivileged]);

    const handleTabChange = useCallback((tabId: string) => {
        if (tabId === activeTab)
            return;
        if (typeof document !== 'undefined') {
            document.body.style.overflow = "";
            document.documentElement.style.overflow = "";
        }
        setActiveTab(tabId);
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            params.set('tab', tabId);
            const newUrl = `${pathname}?${params.toString()}`;
            window.history.replaceState(null, '', newUrl);

            if ((window as any).__lenis) {
                (window as any).__lenis.resize();
                requestAnimationFrame(() => {
                    if ((window as any).__lenis) (window as any).__lenis.resize();
                });
            }
        }
    }, [activeTab, pathname]);

    // Sync from initial url / params change
    useEffect(() => {
        const tabFromUrl = getTabFromUrl();
        if (tabFromUrl && tabFromUrl !== activeTab) {
            setActiveTab(tabFromUrl);
        }
    }, [getTabFromUrl]);

    // Handle browser back/forward buttons smoothly
    useEffect(() => {
        const handlePopState = () => {
            if (typeof window === 'undefined') return;
            const params = new URLSearchParams(window.location.search);
            const tab = params.get('tab') || (isPrivileged ? 'dashboard' : 'incoming');
            setActiveTab(tab);
            if ((window as any).__lenis) {
                (window as any).__lenis.resize();
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [isPrivileged]);

    // Recalculate Lenis scroll dimensions whenever active tab changes
    useEffect(() => {
        if (typeof window !== 'undefined' && (window as any).__lenis) {
            (window as any).__lenis.resize();
            const timer = setTimeout(() => {
                if ((window as any).__lenis) (window as any).__lenis.resize();
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [activeTab]);

    return (
        <>
            <div id="tabs" className="sticky top-0 z-20 flex gap-2 p-2 sm:p-2.5 overflow-x-auto no-scrollbar scroll-smooth touch-pan-x max-w-full bg-[#ebf0f7]/95 dark:bg-[#14151c]/95 backdrop-blur-md shadow-[inset_2px_2px_5px_rgba(166,175,195,0.4),inset_-2px_-2px_5px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.65),inset_-1px_-1px_4px_rgba(255,255,255,0.05)] border-b border-slate-200/60 dark:border-slate-800/80 transition-colors">
                <NavBtn
                    link="dashboard"
                    data-tab="dashboard"
                    isActive={activeTab === "dashboard"}
                    icon={isLoaded && !isPrivileged ? "fas fa-lock" : "fas fa-chart-pie"}
                    label={isLoaded && !isPrivileged ? "Dashboard (Restricted)" : "Dashboard"}
                    onClick={() => handleTabChange("dashboard")}
                />
                <NavBtn link="incoming" data-tab="incoming" isActive={activeTab === "incoming"} icon="fas fa-arrow-down" label="Inbound Receiving" onClick={() => handleTabChange("incoming")}/>
                <NavBtn link="sorting" data-tab="sorting" isActive={activeTab === "sorting"} icon="fas fa-sort" label="Courier Sorting" onClick={() => handleTabChange("sorting")}/>
                <NavBtn link="outgoing" data-tab="outgoing" isActive={activeTab === "outgoing"} icon="fas fa-arrow-up" label="Outgoing Pickup" onClick={() => handleTabChange("outgoing")}/>
            </div>

            <div className="relative min-h-[400px]">
                {Children.map(children, (child) => {
                    if (isValidElement<PanelProps>(child)) {
                        const panelName = child.props['data-panel'] || 'dashboard';
                        const isActive = panelName === activeTab;
                        return (
                            <div
                                key={panelName}
                                className={isActive ? 'block animate-in fade-in duration-150' : 'hidden'}
                                role="tabpanel"
                                aria-hidden={!isActive}
                            >
                                {child}
                            </div>
                        );
                    }
                    return child;
                })}
            </div>
        </>
    );
}
