import {
  SortableData,
  checkboxTableColumn,
  expandTableColumn,
  kebabTableColumn,
} from '~/components/table';
import {
  PipelineKF,
  PipelineRunJobKF,
  PipelineRunKF,
  PipelineCoreResourceKF,
  PipelineVersionKF,
} from '~/concepts/pipelines/kfTypes';

export const pipelineColumns: SortableData<PipelineKF>[] = [
  expandTableColumn(),
  checkboxTableColumn(),
  {
    label: 'Pipeline name',
    field: 'name',
    sortable: (a, b) => a.name.localeCompare(b.name),
    width: 40,
  },
  {
    label: 'Versions',
    field: 'versions',
    sortable: false,
    width: 20,
  },
  {
    label: 'Created',
    field: 'created_at',
    sortable: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    width: 20,
  },
  {
    label: 'Updated',
    field: 'updated',
    sortable: false,
    width: 20,
  },
  kebabTableColumn(),
];

export const pipelineVersionColumns: SortableData<PipelineVersionKF>[] = [
  checkboxTableColumn(),
  {
    label: 'Pipeline version',
    field: 'name',
    sortable: (a, b) => a.name.localeCompare(b.name),
    width: 60,
  },
  {
    label: 'Created',
    field: 'created_at',
    sortable: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    width: 20,
  },
  {
    label: '',
    field: 'Action',
    sortable: false,
    width: 20,
  },
];

const sharedRunLikeColumns: SortableData<PipelineCoreResourceKF>[] = [
  checkboxTableColumn(),
  {
    label: 'Name',
    field: 'name',
    sortable: true,
    width: 20,
  },
  {
    label: 'Experiment',
    field: 'experiment',
    sortable: false,
    width: 10,
  },
  {
    label: 'Pipeline version',
    field: 'pipeline_version',
    sortable: false,
    width: 15,
  },
];

export const pipelineRunColumns: SortableData<PipelineRunKF>[] = [
  ...sharedRunLikeColumns,
  {
    label: 'Started',
    field: 'created_at',
    sortable: true,
  },
  {
    label: 'Duration',
    field: 'duration',
    sortable: false,
  },
  {
    label: 'Status',
    field: 'status',
    sortable: true,
  },
  kebabTableColumn(),
];

export const pipelineRunJobColumns: SortableData<PipelineRunJobKF>[] = [
  ...sharedRunLikeColumns,
  {
    label: 'Trigger',
    field: 'trigger',
    sortable: false,
    width: 15,
  },
  {
    label: 'Scheduled',
    field: 'scheduled',
    sortable: false,
    width: 15,
  },
  {
    label: 'Status',
    field: 'status',
    sortable: false,
    width: 10,
  },
  kebabTableColumn(),
];
