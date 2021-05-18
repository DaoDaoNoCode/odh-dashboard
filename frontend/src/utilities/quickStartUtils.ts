import {
  getQuickStartStatus,
  QuickStartContextValues,
  QuickStartState,
  QuickStartStatus,
} from '@cloudmosaic/quickstarts';
import { objDifference } from './objDifference';
import { useSegmentIOTracking } from './segmentIOTrackingUtils';

export enum LaunchStatusEnum {
  Start = 'Start',
  Continue = 'Continue',
  Restart = 'Restart',
  Close = 'Close',
}

export const getLaunchStatus = (
  quickStartId: string,
  qsContext?: QuickStartContextValues,
): LaunchStatusEnum => {
  if (!quickStartId || !qsContext || !qsContext.allQuickStartStates) {
    return LaunchStatusEnum.Start;
  }

  const quickStartState = qsContext.allQuickStartStates[quickStartId];

  if (!quickStartState) {
    return LaunchStatusEnum.Start;
  }

  if (quickStartState.taskNumber === -1) {
    if (qsContext.activeQuickStartID === quickStartId) {
      return LaunchStatusEnum.Close;
    }
    return LaunchStatusEnum.Start;
  }

  if (
    qsContext.activeQuickStartID === quickStartId ||
    quickStartState.status === QuickStartStatus.COMPLETE
  ) {
    return LaunchStatusEnum.Restart;
  }

  if (quickStartState.status === QuickStartStatus.IN_PROGRESS) {
    return LaunchStatusEnum.Continue;
  }

  return LaunchStatusEnum.Start;
};

export const getQuickStartLabel = (
  quickStartId?: string | null,
  qsContext?: QuickStartContextValues,
): string => {
  if (!quickStartId || !qsContext || !qsContext.allQuickStartStates) {
    return '';
  }
  const launchStatus = getLaunchStatus(quickStartId, qsContext);

  return `${launchStatus}`;
};

export const isQuickStartInProgress = (
  quickStartId?: string | null,
  qsContext?: QuickStartContextValues,
): boolean => {
  if (!quickStartId || !qsContext || !qsContext.allQuickStartStates) {
    return false;
  }
  const launchStatus = getLaunchStatus(quickStartId, qsContext);

  return launchStatus === LaunchStatusEnum.Continue;
};

export const isQuickStartComplete = (
  quickStartId?: string | null,
  qsContext?: QuickStartContextValues,
): boolean => {
  if (!quickStartId || !qsContext || !qsContext.allQuickStartStates) {
    return false;
  }
  return (
    getQuickStartStatus(qsContext.allQuickStartStates, quickStartId) === QuickStartStatus.COMPLETE
  );
};

export const launchQuickStart = (
  quickStartId: string | null,
  qsContext: QuickStartContextValues,
): void => {
  if (
    !quickStartId ||
    !qsContext ||
    !qsContext.setActiveQuickStart ||
    !qsContext.restartQuickStart
  ) {
    return;
  }

  if (!qsContext.allQuickStartStates) {
    qsContext.setActiveQuickStart(quickStartId);
    return;
  }

  const launchStatus = getLaunchStatus(quickStartId, qsContext);

  if (launchStatus === LaunchStatusEnum.Restart) {
    const quickStart = qsContext.allQuickStarts?.find((qs) => qs.metadata.name === quickStartId);
    qsContext.restartQuickStart(quickStartId, quickStart?.spec?.tasks?.length ?? 0);
    return;
  }

  qsContext.setActiveQuickStart(quickStartId);
};

export const fireQuickStartEvent = (quickStartID: string, oldQuickStartState: QuickStartState, newQuickStartState: QuickStartState) => {
  const quickStartStateDifference: QuickStartState = objDifference(newQuickStartState, oldQuickStartState);
  console.log(quickStartStateDifference);
  const { status, taskNumber } = newQuickStartState;
  if (quickStartStateDifference.hasOwnProperty('status')) {
    if (status == QuickStartStatus.NOT_STARTED) {
     useSegmentIOTracking("Quick Start Initiated", {
        id: quickStartID,
        type: 'start'
      })
    }
    if (status == QuickStartStatus.COMPLETE) {
      useSegmentIOTracking("Quick Start Completed", {
        id: quickStartID
      })
    }
  }
  if (status == QuickStartStatus.IN_PROGRESS) {
    if (taskNumber == -1) {
      useSegmentIOTracking("Quick Start Initiated", {
        id: quickStartID,
        type: 'restart'
      })
    } else {
      if (quickStartStateDifference.hasOwnProperty('taskNumber')) {
        useSegmentIOTracking("Quick Start In Progress", {
          id: quickStartID,
          taskNumber: taskNumber
        })
      } else {
        useSegmentIOTracking("Quick Start In Progress", {
          id: quickStartID,
          ...quickStartStateDifference
        })
      }
    }
  }
}
