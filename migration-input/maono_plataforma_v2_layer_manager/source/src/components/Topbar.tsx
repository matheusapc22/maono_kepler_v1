import React from 'react';
import { Globe, Bell, ChevronDown } from 'lucide-react';

export function Topbar() {
  return (
    // 🚀 AJUSTE 1: Barra absoluta sobre o mapa, transparente e transpassável (pointer-events-none)
    <header className="absolute top-0 left-0 w-full h-16 bg-transparent text-white flex justify-between items-center px-6 z-50 pointer-events-none">
      
      {/* Container vazio à esquerda */}
      <div className="flex items-center gap-3"></div>

      {/* 🚀 AJUSTE 2: Reativamos os cliques (pointer-events-auto) + Pílula de vidro (Glassmorphism) para contraste */}
      <div className="flex items-center gap-5 pointer-events-auto bg-[#04060a]/40 backdrop-blur-md px-5 py-2.5 rounded-2xl border border-[#1f2b3e]/50 shadow-[0_10px_30px_rgba(0,0,0,0.5)] transition-all hover:bg-[#04060a]/60">
        
        {/* 1. SELETOR DE IDIOMA */}
        <button className="flex items-center gap-1.5 text-xs text-[#d1d5db] hover:text-[#C5A059] font-semibold transition-colors group outline-none">
          <Globe className="w-4 h-4" />
          <span>EN</span>
          <ChevronDown className="w-3 h-3 opacity-50 group-hover:opacity-100" />
        </button>

        {/* Separador visual sutil */}
        <div className="w-[1px] h-4 bg-[#1f2b3e]"></div>

        {/* 2. NOTIFICAÇÕES */}
        <button className="relative text-[#d1d5db] hover:text-white transition-colors group outline-none">
          <Bell className="w-5 h-5 group-hover:scale-110 transition-transform" />
          <span className="absolute top-0 right-0 w-2 h-2 bg-[#C5A059] border border-[#04060a] rounded-full shadow-[0_0_8px_rgba(197,160,89,0.8)]"></span>
        </button>

        {/* 3. PERFIL DO USUÁRIO (Avatar) */}
        <button className="ml-1 flex items-center gap-2 hover:opacity-80 transition-opacity outline-none">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#131c2a] to-[#1f2b3e] border border-[#C5A059]/30 flex items-center justify-center shadow-inner hover:border-[#C5A059] transition-colors">
            <span className="text-[10px] font-bold text-[#C5A059] tracking-wider">JD</span>
          </div>
        </button>

      </div>
    </header>
  );
}