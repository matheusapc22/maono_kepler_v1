import { useEffect, useState } from "react";
import { BarChart2, FileText, Folder, Home, Layers, LogOut, Settings, SunMoon, Users } from "lucide-react";
import LogoSimbolo from "../assets/images/Logo_Simbolo.png";
import { maonoApi } from "../services/api";

interface SidebarProps {
  activePanel: string;
  onPanelSelect: (panel: string) => void;
  onOpenDataModal: () => void;
  onToggleTheme?: () => void;
  onLogout?: () => void;
}

export function Sidebar({ activePanel, onPanelSelect, onOpenDataModal, onToggleTheme, onLogout }: SidebarProps) {
  const [userRole, setUserRole] = useState("VIEWER");

  useEffect(() => {
    const token = localStorage.getItem("@maono:token");
    if (token) {
      maonoApi.getMe(token)
        .then((response) => { if (response?.user) setUserRole(response.user.role); })
        .catch((error) => console.error("Erro ao validar sessão na Sidebar:", error));
    }
  }, []);

  const handleLogout = () => {
    if (onLogout) onLogout();
    else {
      localStorage.removeItem("@maono:token");
      window.location.href = "/login";
    }
  };

  const role = String(userRole).toUpperCase();
  const menuItems = [
    { id: "layers", icon: Layers, label: "Camadas", action: () => onPanelSelect("layers"), show: true },
    { id: "charts", icon: BarChart2, label: "Análises", action: () => onPanelSelect("charts"), show: true },
    { id: "dados", icon: Folder, label: "Gestão de Dados", action: onOpenDataModal, show: true },
    { id: "files", icon: FileText, label: "Arquivos e Documentos", action: () => onPanelSelect("files"), show: true },
    { id: "users", icon: Users, label: "Usuários", action: () => onPanelSelect("users"), show: ["MASTER", "OWNER", "ADMIN", "SUPER_ADMIN"].includes(role) },
    { id: "home", icon: Home, label: "Início", action: () => onPanelSelect("home"), show: true },
  ].filter((item) => item.show);

  return (
    <aside className="z-[60] flex w-20 flex-col items-center border-r border-[#161f30] bg-[#04060a] pb-6 pt-8 text-white">
      <img src={LogoSimbolo} alt="Maõno Logo" className="mb-20 h-auto w-10 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]" />
      <div className="flex w-full flex-col items-center gap-4">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePanel === item.id;
          return (
            <div key={item.id} className="group relative flex w-full justify-center">
              <button
                type="button"
                onClick={item.action}
                className={`flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-500 ${
                  isActive
                    ? "border border-[#C5A059]/40 bg-gradient-to-b from-[#131c2a] to-[#0b1019] text-[#C5A059] shadow-[inset_0_1px_0_rgba(197,160,89,0.2),0_0_15px_rgba(197,160,89,0.1)]"
                    : "border border-transparent text-gray-600 hover:bg-[#0a0f18] hover:text-gray-300"
                }`}
                aria-label={item.label}
                title={item.label}
              >
                <Icon className="h-[22px] w-[22px] drop-shadow-md" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-auto flex w-full flex-col items-center space-y-4">
        {role === "SUPER_ADMIN" && (
          <button type="button" onClick={() => onPanelSelect("organizations")} className={`flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-500 ${activePanel === "organizations" ? "border border-[#C5A059]/40 bg-gradient-to-b from-[#131c2a] to-[#0b1019] text-[#C5A059]" : "text-gray-600 hover:bg-[#0a0f18] hover:text-[#C5A059]"}`} title="Painel do CEO">
            <Settings className="h-[22px] w-[22px]" />
          </button>
        )}
        <button type="button" onClick={onToggleTheme} className="flex h-12 w-12 items-center justify-center rounded-xl text-gray-600 hover:bg-[#0a0f18] hover:text-[#C5A059]" title="Tema"><SunMoon className="h-[22px] w-[22px]" /></button>
        <button type="button" onClick={handleLogout} className="flex h-12 w-12 items-center justify-center rounded-xl text-gray-600 hover:bg-[#1a0f14] hover:text-red-500" title="Sair"><LogOut className="h-[22px] w-[22px]" /></button>
      </div>
    </aside>
  );
}
