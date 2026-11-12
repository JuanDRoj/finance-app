export type ChartTableRow = {
  /** A key that does not repeat in the table: the month. */
  key: string;
  /** The row's header: the month. */
  header: string;
  /** The rest of the cells, in the order of `columns` after the first. */
  cells: readonly string[];
};

/**
 * The text alternative of a chart (docs/diseno.md D9), for screen readers only: the same figures the
 * tooltip gives, all at once. `columns[0]` heads the column of months.
 */
export function ChartDataTable({
  caption,
  columns,
  rows,
}: Readonly<{ caption: string; columns: readonly string[]; rows: readonly ChartTableRow[] }>) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.header}</th>
            {row.cells.map((cell, index) => (
              <td key={columns[index + 1] ?? index}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
