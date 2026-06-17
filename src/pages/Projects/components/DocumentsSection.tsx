import type { ReactNode } from "react";

import type { MaonoProject } from "../../../auth/session";

type TableCell = ReactNode;

function Table({ headers, rows }: { headers: string[]; rows: TableCell[][] }) {
  return (
    <div className="mm-table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={`${index}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocumentsSection({
  projects,
}: {
  projects: MaonoProject[];
}) {
  return (
    <section className="mm-card mm-section-card">
      <h2>Arquivos e Documentos</h2>
      <p>
        Arquivos vinculados aos mapas e documentos da organização. Caminhos
        internos de armazenamento não são exibidos nesta tela.
      </p>

      <Table
        headers={["Projeto", "Configuração", "Preview", "Status"]}
        rows={projects.map((project) => [
          project.name,
          "Configuração Kepler",
          `${project.slug}.png`,
          "Vinculado ao projeto",
        ])}
      />
    </section>
  );
}
