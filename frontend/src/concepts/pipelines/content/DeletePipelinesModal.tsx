import * as React from 'react';
import { Stack, StackItem } from '@patternfly/react-core';
import DeleteModal from '~/pages/projects/components/DeleteModal';
import { usePipelinesAPI } from '~/concepts/pipelines/context';
import { PipelineKF, PipelineVersionKF } from '~/concepts/pipelines/kfTypes';
import useDeleteStatuses from '~/concepts/pipelines/content/useDeleteStatuses';
import DeletePipelineModalExpandableSection from '~/concepts/pipelines/content/DeletePipelineModalExpandableSection';
import { getPipelineAndVersionDeleteString } from '~/concepts/pipelines/content/utils';

type DeletePipelinesModalProps = {
  isOpen: boolean;
  toDeletePipelines?: PipelineKF[];
  toDeletePipelineVersions?: { pipelineName: string; version: PipelineVersionKF }[];
  onClose: (deleted?: boolean) => void;
};

const DeletePipelinesModal: React.FC<DeletePipelinesModalProps> = ({
  isOpen,
  toDeletePipelines = [],
  toDeletePipelineVersions = [],
  onClose,
}) => {
  const { api } = usePipelinesAPI();
  const toDeleteVersions = React.useMemo(
    () => toDeletePipelineVersions.map((version) => version.version),
    [toDeletePipelineVersions],
  );
  const { deleting, setDeleting, error, setError, deleteStatuses, onBeforeClose, abortSignal } =
    useDeleteStatuses({
      onClose,
      type: 'pipeline',
      toDeleteResources: [...toDeletePipelines, ...toDeleteVersions],
    });
  const resourceCount = toDeletePipelines.length + toDeletePipelineVersions.length;

  if (resourceCount === 0) {
    return null;
  }

  let deleteTitle;
  let deleteName;
  let deleteDescription = <>This action cannot be undone.</>;
  if (resourceCount > 1) {
    deleteTitle = 'Delete pipelines?';
    if (toDeletePipelines.length === 0) {
      deleteName = `Delete ${toDeletePipelineVersions.length} pipeline versions`;
    } else if (toDeletePipelineVersions.length === 0) {
      deleteName = `Delete ${toDeletePipelines.length} pipelines`;
      deleteDescription = (
        <>All versions from {toDeletePipelines.length} pipelines will be deleted.</>
      );
    } else {
      deleteName = `Delete ${getPipelineAndVersionDeleteString(
        toDeletePipelines,
        'pipeline',
      )} and ${getPipelineAndVersionDeleteString(toDeleteVersions, 'version')}`;
      deleteDescription = (
        <>
          All versions from {getPipelineAndVersionDeleteString(toDeletePipelines, 'pipeline')} and{' '}
          {getPipelineAndVersionDeleteString(toDeleteVersions, 'version')} from different pipelines
          will be deleted.
        </>
      );
    }
  } else if (toDeletePipelineVersions.length === 1) {
    deleteTitle = 'Delete pipeline version?';
    deleteName = toDeletePipelineVersions[0].version.name;
    deleteDescription = (
      <>
        <strong>{toDeletePipelineVersions[0].version.name}</strong>, a version of your{' '}
        <strong>{toDeletePipelineVersions[0].pipelineName}</strong> pipeline, will be deleted.
      </>
    );
  } else {
    deleteTitle = 'Delete pipeline?';
    deleteName = toDeletePipelines[0].name;
  }

  return (
    <DeleteModal
      title={deleteTitle}
      isOpen={isOpen}
      onClose={() => onBeforeClose(false)}
      deleting={deleting}
      error={error}
      onDelete={() => {
        if (resourceCount === 0) {
          return;
        }
        setDeleting(true);
        setError(undefined);

        const allPromises = [
          ...toDeletePipelines.map((resource) =>
            api.deletePipeline({ signal: abortSignal }, resource.id),
          ),
          ...toDeletePipelineVersions.map((resource) =>
            api.deletePipelineVersion({ signal: abortSignal }, resource.version.id),
          ),
        ];

        if (allPromises.length === 1) {
          allPromises[0]
            .then(() => onBeforeClose(true))
            .catch((e) => {
              setError(e);
              setDeleting(false);
            });
        } else {
          Promise.allSettled(allPromises).then((results) =>
            onBeforeClose(
              true,
              results.map((result) => (result.status === 'fulfilled' ? true : result.reason)),
            ),
          );
        }
      }}
      submitButtonLabel="Delete"
      deleteName={deleteName}
    >
      {resourceCount <= 1 ? (
        deleteDescription
      ) : (
        <Stack hasGutter>
          <StackItem>{deleteDescription}</StackItem>
          {toDeletePipelines.length !== 0 && (
            <StackItem>
              <DeletePipelineModalExpandableSection
                toDeleteResources={toDeletePipelines}
                type="pipelines"
                deleting={deleting}
                deleteStatuses={deleteStatuses}
              >
                {(pipeline) => <div>{pipeline.name}</div>}
              </DeletePipelineModalExpandableSection>
            </StackItem>
          )}
          {toDeletePipelineVersions.length !== 0 && (
            <StackItem>
              <DeletePipelineModalExpandableSection
                toDeleteResources={toDeleteVersions}
                type="pipeline versions"
                deleting={deleting}
                deleteStatuses={deleteStatuses}
              >
                {(version) => <div>{version.name}</div>}
              </DeletePipelineModalExpandableSection>
            </StackItem>
          )}
        </Stack>
      )}
    </DeleteModal>
  );
};

export default DeletePipelinesModal;
