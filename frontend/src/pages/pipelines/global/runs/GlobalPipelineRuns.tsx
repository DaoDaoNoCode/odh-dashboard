import * as React from 'react';
import {
  pipelineRunsPageDescription,
  pipelineRunsPageTitle,
} from '~/pages/pipelines/global/runs/const';
import PipelineCoreApplicationPage from '~/pages/pipelines/global/PipelineCoreApplicationPage';
import EnsureAPIAvailability from '~/concepts/pipelines/EnsureAPIAvailability';
import PipelineRunVersionsContextProvider from '~/pages/pipelines/global/runs/PipelineRunVersionsContext';
import GlobalPipelineRunsTabs from './GlobalPipelineRunsTabs';

const GlobalPipelineRuns: React.FC = () => (
  <PipelineCoreApplicationPage
    title={pipelineRunsPageTitle}
    description={pipelineRunsPageDescription}
    getRedirectPath={(namespace) => `/pipelineRuns/${namespace}`}
    overrideChildPadding
  >
    <EnsureAPIAvailability>
      <PipelineRunVersionsContextProvider>
        <GlobalPipelineRunsTabs />
      </PipelineRunVersionsContextProvider>
    </EnsureAPIAvailability>
  </PipelineCoreApplicationPage>
);

export default GlobalPipelineRuns;
