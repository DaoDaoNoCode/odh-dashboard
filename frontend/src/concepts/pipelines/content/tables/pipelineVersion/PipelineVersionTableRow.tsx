import * as React from 'react';
import { Td, Tr } from '@patternfly/react-table';
import { Button } from '@patternfly/react-core';
import { Link, useNavigate } from 'react-router-dom';
import { PipelineVersionKF } from '~/concepts/pipelines/kfTypes';
import { CheckboxTd, TableRowTitleDescription } from '~/components/table';
import { usePipelinesAPI } from '~/concepts/pipelines/context';
import PipelinesTableRowTime from '~/concepts/pipelines/content/tables/PipelinesTableRowTime';
import { PipelineRunType } from '~/pages/pipelines/global/runs/GlobalPipelineRunsTabs';

type PipelineVersionTableRowProps = {
  isChecked: boolean;
  onToggleCheck: () => void;
  pipelineVersionDetailsPath: (namespace: string, id: string) => string;
  version: PipelineVersionKF;
  isDisabled: boolean;
};

const PipelineVersionTableRow: React.FC<PipelineVersionTableRowProps> = ({
  isChecked,
  onToggleCheck,
  pipelineVersionDetailsPath,
  version,
  isDisabled,
}) => {
  const navigate = useNavigate();
  const { namespace } = usePipelinesAPI();
  const createdDate = new Date(version.created_at);

  return (
    <Tr>
      <CheckboxTd
        id={version.id}
        isChecked={isChecked}
        onToggle={onToggleCheck}
        isDisabled={isDisabled}
      />
      <Td>
        <TableRowTitleDescription
          title={<Link to={pipelineVersionDetailsPath(namespace, version.id)}>{version.name}</Link>}
          description={version.description}
          descriptionAsMarkdown
        />
      </Td>
      <Td>
        <PipelinesTableRowTime date={createdDate} />
      </Td>
      <Td>
        <Button
          variant="link"
          isInline
          onClick={() =>
            navigate(
              {
                pathname: `/pipelineRuns/${namespace}`,
                search: `?runType=${PipelineRunType.Triggered}`,
              },
              {
                state: { lastVersion: version },
              },
            )
          }
        >
          View runs
        </Button>
      </Td>
    </Tr>
  );
};

export default PipelineVersionTableRow;
