import * as React from 'react';
import { TableComposable, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { Button } from '@patternfly/react-core';
import { GetColumnSort } from '../../../../utilities/useTableColumnSort';
import { InferenceServiceKind } from '../../../../k8sTypes';
import { columns } from './data';
import InferenceServiceTableRow from './InferenceServiceTableRow';

type InferenceServiceTableProps = {
  clearFilters?: () => void;
  inferenceServices: InferenceServiceKind[];
  getColumnSort: GetColumnSort;
};

const InferenceServiceTable: React.FC<InferenceServiceTableProps> = ({
  clearFilters,
  inferenceServices,
  getColumnSort,
}) => {
  const isGlobal = !!clearFilters;
  const mappedColumns = isGlobal ? columns : columns.filter((column) => column.field !== 'project');
  return (
    <TableComposable variant={isGlobal ? undefined : 'compact'}>
      <Thead>
        <Tr>
          {mappedColumns.map((col, i) => (
            <Th key={col.field} sort={getColumnSort(i)} width={col.width}>
              {col.label}
            </Th>
          ))}
        </Tr>
      </Thead>
      {isGlobal && inferenceServices.length === 0 && (
        <Tbody>
          <Tr>
            <Td colSpan={columns.length} style={{ textAlign: 'center' }}>
              No projects match your filters.{' '}
              <Button variant="link" isInline onClick={clearFilters}>
                Clear filters
              </Button>
            </Td>
          </Tr>
        </Tbody>
      )}
      {inferenceServices.map((is) => (
        <InferenceServiceTableRow key={is.metadata.uid} obj={is} isGlobal={isGlobal} />
      ))}
    </TableComposable>
  );
};

export default InferenceServiceTable;
