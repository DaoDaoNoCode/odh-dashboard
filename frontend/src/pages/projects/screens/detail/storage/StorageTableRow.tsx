import * as React from 'react';
import { ActionsColumn, ExpandableRowContent, Td, Tr } from '@patternfly/react-table';
import { Text, Title } from '@patternfly/react-core';
import { getPvcDescription, getPvcDisplayName } from '../../../utils';
import { PersistentVolumeClaimKind } from '../../../../../k8sTypes';
import { HddIcon } from '@patternfly/react-icons';
import StorageSizeBar from '../../../components/StorageSizeBars';

type StorageTableRowProps = {
  obj: PersistentVolumeClaimKind;
};

const StorageTableRow: React.FC<StorageTableRowProps> = ({ obj }) => {
  const [isExpanded, setExpanded] = React.useState<boolean>(false);

  return (
    <>
      <Tr>
        <Td expand={{ rowIndex: 0, isExpanded, onToggle: () => setExpanded(!isExpanded) }} />
        <Td>
          <Title headingLevel="h4">{getPvcDisplayName(obj)}</Title>
          <Text>{getPvcDescription(obj)}</Text>
        </Td>
        <Td>
          <Text>
            <HddIcon />
            {` Persistent storage`}
          </Text>
        </Td>
        <Td>Wind turbines</Td>
        <Td isActionCell>
          <ActionsColumn
            items={[
              {
                title: 'Edit storage',
                onClick: () => {
                  alert('Not implemented yet');
                },
              },
              {
                title: 'Delete storage',
                onClick: () => {
                  alert('Not implemented yet');
                },
              },
            ]}
          />
        </Td>
      </Tr>
      <Tr isExpanded={isExpanded}>
        <Td />
        <Td>
          <ExpandableRowContent>
            <strong>Size</strong>
            <StorageSizeBar pvc={obj} />
          </ExpandableRowContent>
        </Td>
        <Td />
        <Td />
        <Td />
      </Tr>
    </>
  );
};

export default StorageTableRow;
