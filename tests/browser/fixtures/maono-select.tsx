import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MaonoSelect } from "../../../src/components/selection/MaonoSelect";
import "../../../src/maono-design-tokens.css";
import "../../../src/platform-density.css";

export function Fixture() {
  const [value, setValue] = useState("alpha");
  const [changes, setChanges] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [data, setData] = useState("");
  const [locked, setLocked] = useState(false);
  const [updatedOptions, setUpdatedOptions] = useState(false);
  const [mounted, setMounted] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const ref = useRef<HTMLSelectElement>(null);
  return <main style={{ padding: 24, maxWidth: 550, color: "#e8edf5", background: "#0b1016", font: "14px system-ui" }}>
    <h1>Controles Maõno</h1>
    <form id="fields" onSubmit={event => { event.preventDefault(); setData(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))); }}>
      <label htmlFor="controlled">Perfil controlado</label>
      <MaonoSelect ref={ref} id="controlled" name="profile" value={value} disabled={disabled} onChange={event => { setValue(event.target.value); setChanges(count => count + 1); }}>
        <option value="alpha">Alpha</option><option value="beta">Beta</option><option disabled value="disabled">Bloqueado</option><option value="gamma">Gamma</option>
      </MaonoSelect>
      <output aria-label="Alterações">{changes}</output><output aria-label="Valor">{value}</output>
      <label>Não controlado<MaonoSelect name="plain" defaultValue="two"><option value="one">Um</option><option value="two">Dois</option><option value="three">Três</option></MaonoSelect></label>
      <label>Obrigatório<MaonoSelect name="required" required defaultValue=""><option value="" disabled>Selecione</option><option value="ok">Confirmado</option></MaonoSelect></label>
      <button type="reset">Redefinir</button><button type="submit">Enviar</button>
    </form>
    <button onClick={() => setDisabled(current => !current)}>Alternar desabilitado</button>
    <button onClick={() => ref.current?.focus()}>Focar via ref</button>
    <button onClick={() => setValue("gamma")}>Atualização externa</button>
    <button onClick={() => dialog.current?.showModal()}>Abrir modal</button>
    <label>Vazio<MaonoSelect aria-label="Vazio" /></label>
    <label>Grupos e nomes longos<MaonoSelect form="fields" name="group" defaultValue="choice-3"><optgroup label="Indisponíveis" disabled><option value="blocked">Não permitido</option></optgroup><optgroup label="Equipe">{Array.from({ length: 60 }, (_, index) => <option key={index} value={`choice-${index}`}>{`${String(index).padStart(2, "0")} ${index === 59 ? "Organização com nome longo ".repeat(8) : "Pessoa"}`}</option>)}</optgroup></MaonoSelect></label>
    <label>Lista múltipla nativa<MaonoSelect multiple name="multiple" defaultValue={["a", "b"]}><option value="a">A</option><option value="b">B</option><option value="c">C</option></MaonoSelect></label>
    <button onClick={() => window.setTimeout(() => setLocked(true), 600)}>Agendar bloqueio</button>
    <button onClick={() => setLocked(false)}>Liberar grupo</button>
    <fieldset disabled={locked}><label>Grupo bloqueável<MaonoSelect defaultValue="a"><option value="a">Primeira</option><option value="b">Segunda</option></MaonoSelect></label></fieldset>
    <button onClick={() => window.setTimeout(() => setUpdatedOptions(true), 600)}>Atualizar opções depois</button>
    <label>Opções dinâmicas<MaonoSelect defaultValue="a"><option value="a" disabled={updatedOptions}>Original</option>{updatedOptions ? <option value="new">Nova opção</option> : <option value="b">Outra opção</option>}</MaonoSelect></label>
    <button onClick={() => window.setTimeout(() => setMounted(false), 600)}>Remover controle depois</button>
    {mounted ? <label>Controle removível<MaonoSelect><option value="a">Antes</option><option value="b">Depois</option></MaonoSelect></label> : null}
    <button>Depois</button><output aria-label="Formulário">{data}</output>
    <dialog ref={dialog} style={{ width: 240, height: 160, overflow: "hidden" }} onCancel={event => { event.preventDefault(); dialog.current?.close(); }}>
      <form method="dialog"><label>Perfil no modal<MaonoSelect defaultValue="alpha"><option value="alpha">Alpha</option><option value="beta">Beta</option>{Array.from({ length: 30 }, (_, index) => <option key={index} value={String(index)}>{`Alternativa ${index}`}</option>)}</MaonoSelect></label><button>Fechar modal</button></form>
    </dialog>
  </main>;
}
createRoot(document.getElementById("fixture-root")!).render(<StrictMode><Fixture /></StrictMode>);
