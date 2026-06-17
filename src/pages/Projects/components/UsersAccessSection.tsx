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

export default function UsersAccessSection({
  user,
}: {
  user: MaonoUser | null;
}) {
  return (
    <section className="mm-card mm-section-card">
      <h2>Usuários e Acessos</h2>
      <p>
        Gestão de usuários internos da organização e vínculos de acesso aos
        projetos.
      </p>

      <Table
        headers={["Usuário", "Perfil", "Escopo"]}
        rows={[
          [
            user?.name || user?.email || "Usuário atual",
            user?.role || "role",
            "Organização atual",
          ],
        ]}
      />
    </section>
  );
}
