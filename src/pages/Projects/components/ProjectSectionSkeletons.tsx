import { Skeleton, TableSkeleton } from "../../../components/loading/Skeleton";

// These placeholders reuse the real section/card/table layout and the shared
// shimmer. The owning section supplies one live status and aria-busy state.
export function OrganizationSectionSkeleton({ metrics }: { metrics: boolean }) {
  return <div className="mm-section-loading" aria-hidden="true">
    <div className="mm-card">
      <h3><Skeleton width={150} height={24} /></h3>
      <div className="mm-table-wrap"><table><tbody>
        {Array.from({ length: 7 }, (_, index) => <tr key={index}>
          <th><Skeleton width={90} height={13} /></th>
          <td><Skeleton width={`${44 + index % 3 * 14}%`} height={16} /></td>
        </tr>)}
      </tbody></table></div>
    </div>
    {metrics ? <div className="mm-card">
      <h3><Skeleton width={95} height={24} /></h3>
      <div className="mm-metrics-grid compact">{Array.from({ length: 5 }, (_, index) => <div className="mm-card metric mm-metric-skeleton" key={index}>
        <Skeleton width="54%" height={12} /><Skeleton width="34%" height={30} />
      </div>)}</div>
    </div> : null}
    <div className="mm-card mm-skeleton-stack">
      <Skeleton width={90} height={20} /><Skeleton width="62%" height={14} />
      <Skeleton width={160} height={36} />
    </div>
  </div>;
}

export function LimitsPlansSectionSkeleton({ requestForm }: { requestForm: boolean }) {
  return <div className="mm-section-loading" aria-hidden="true">
    <div className="mm-card mm-skeleton-stack">
      <Skeleton width={120} height={20} /><Skeleton width={65} height={25} radius={999} />
      <Skeleton width="64%" height={14} />
    </div>
    <div className="mm-card">
      <h3><Skeleton width={150} height={24} /></h3>
      <TableSkeleton headers={["Categoria", "Uso atual", "Limite", "Uso"]} rows={4} className="mm-limits-usage-skeleton" />
    </div>
    <div className="mm-card mm-skeleton-stack">
      <Skeleton width={240} height={20} />
      {requestForm ? <>
        <div className="mm-form-grid">
          {[0, 1, 2].map(index => <div className="mm-skeleton-stack" key={index}>
            <Skeleton width={85} height={14} /><Skeleton height={index === 2 ? 74 : 38} />
          </div>)}
        </div>
        <Skeleton width={160} height={36} />
      </> : <Skeleton width="62%" height={14} />}
    </div>
    <div className="mm-card mm-skeleton-stack">
      <Skeleton width={210} height={20} /><Skeleton height={48} />
    </div>
  </div>;
}

export function UsersMetricsSkeleton() {
  return <>{Array.from({ length: 4 }, (_, index) => <article key={index} aria-hidden="true" className="mm-skeleton-stack">
    <Skeleton width="68%" height={12} /><Skeleton width={54} height={29} />
  </article>)}</>;
}

export function UsersTableSkeletonRows({ rows = 10 }: { rows?: number }) {
  return <>{Array.from({ length: rows }, (_, row) => <tr key={row} aria-hidden="true" className="people-skeleton-row">
    <td><div className="mm-skeleton-stack"><Skeleton width="76%" height={15} /><Skeleton width="60%" height={11} /></div></td>
    {[0, 1, 2, 3].map(column => <td key={column}><Skeleton width={`${52 + (row + column) % 3 * 16}%`} height={column === 0 ? 24 : 13} radius={column === 0 ? 999 : 6} /></td>)}
    <td><Skeleton width={28} height={28} /></td>
  </tr>)}</>;
}
