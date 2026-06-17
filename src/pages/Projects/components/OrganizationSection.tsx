import type { ReactNode } from "react";

import type { MaonoUser } from "../../../auth/session";

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

export default function OrganizationSection({
  user,
  projectsCount,
}: {
  user: MaonoUser | null;
  projectsCount: number;
}) {
  const organizationName =
    user?.activeOrganization?.name ||
    user?.organization?.name ||
    "Organização atual";

  return (
    <section className="mm-card mm-section-card">
      <h2>Organização</h2>
      <p>
        Resumo da organização cliente, projetos liberados e contexto ativo do
        usuário.
      </p>

      <Table
        headers={["Indicador", "Valor"]}
        rows={[
          ["Organização", organizationName],
          ["Projetos ativos", String(projectsCount)],
          ["Perfil atual", user?.role || "role"],
        ]}
      />
    </section>
  );
}
