import React from "react";
import { Link } from "react-router";

const BackToProjectsButton: React.FC = () => {
  return (
    <Link
      to="/projects"
      className="fixed left-5 top-5 z-[99999] inline-flex items-center gap-2 rounded-2xl border border-slate-600/70 bg-[#111827]/95 px-4 py-3 text-sm font-bold text-white shadow-2xl shadow-black/30 backdrop-blur transition hover:border-blue-300/60 hover:bg-[#1f2937] focus:outline-none focus:ring-2 focus:ring-blue-400/60"
      title="Voltar para o painel de projetos"
      aria-label="Voltar para o painel de projetos"
    >
      <span className="text-lg leading-none">←</span>
      <span>Projetos</span>
    </Link>
  );
};

export default BackToProjectsButton;
