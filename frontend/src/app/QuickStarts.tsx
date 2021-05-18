import React from 'react';
import * as _ from 'lodash';
import {
  QuickStartDrawer,
  QuickStartContext,
  useValuesForQuickStartContext,
  useLocalStorage,
  AllQuickStartStates
} from '@cloudmosaic/quickstarts';
import '@patternfly/patternfly/base/patternfly-shield-inheritable.css';
import '@patternfly/patternfly/utilities/Accessibility/accessibility.css';
import '@patternfly/react-catalog-view-extension/dist/css/react-catalog-view-extension.css';
import '@cloudmosaic/quickstarts/dist/quickstarts.css';
import { useWatchQuickStarts } from '../utilities/useWatchQuickStarts';
import { objDifference } from '../utilities/objDifference';
import { fireQuickStartEvent } from '../utilities/quickStartUtils';

const QuickStarts: React.FC = ({ children }) => {
  const [activeQuickStartID, setActiveQuickStartID] = useLocalStorage('rhodsQuickstartId', '');
  const [allQuickStartStates, setAllQuickStartStates] = useLocalStorage('rhodsQuickstarts', {});
  const { quickStarts } = useWatchQuickStarts();

  const setStateAndFireEvents: (value: React.SetStateAction<AllQuickStartStates>) => void = (newState: any) => {
    // find diff between newState and allQuickStartStates, and based on that send the appropriate segment track event
    const newAllQuickStartStates = newState(allQuickStartStates);
    if (!_.isEqual(newAllQuickStartStates, allQuickStartStates)) {
      Object.keys(objDifference(newAllQuickStartStates, allQuickStartStates)).forEach(quickStartID => {
        fireQuickStartEvent(quickStartID, allQuickStartStates[quickStartID] ?? {}, newAllQuickStartStates[quickStartID]);
      });
    }
    setAllQuickStartStates(newState);
  }

  const valuesForQuickStartContext = useValuesForQuickStartContext({
    allQuickStarts: quickStarts || [],
    activeQuickStartID,
    setActiveQuickStartID,
    allQuickStartStates,
    setAllQuickStartStates: setStateAndFireEvents,
  });

  return (
    <QuickStartContext.Provider value={valuesForQuickStartContext}>
      <QuickStartDrawer>{children}</QuickStartDrawer>
    </QuickStartContext.Provider>
  );
};

export default QuickStarts;
