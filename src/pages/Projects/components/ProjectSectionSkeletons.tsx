import { Skeleton } from "../../../components/loading/Skeleton";
import { useSkeletonCount } from "../../../components/loading/useSkeletonCount";

// Decorative rows reserve only the visible page area; headers stay in the real table.
export function UsersTableSkeletonRows({ rows = 10 }: { rows?: number }) {
  const count = useSkeletonCount({ layout: "table", pageSize: rows, itemHeight: 58, reservedHeight: 390 });
  return <>{Array.from({ length: count }, (_, row) => <tr key={row} aria-hidden="true" className="people-skeleton-row">
    <td><div className="mm-skeleton-stack"><Skeleton width="76%" height={15} /><Skeleton width="60%" height={11} /></div></td>
    {[0, 1, 2, 3].map(column => <td key={column}><Skeleton width={`${52 + (row + column) % 3 * 16}%`} height={column === 0 ? 24 : 13} radius={column === 0 ? 999 : 6} /></td>)}
    <td><Skeleton width={28} height={28} /></td>
  </tr>)}</>;
}
