import React from 'react';
import { useDispatch } from 'react-redux';
import '@patternfly/patternfly/patternfly.min.css';
import { Page } from '@patternfly/react-core';
import { detectUser } from '../redux/actions/actions';
import { useDesktopWidth } from '../utilities/useDesktopWidth';
import Header from './Header';
import Routes from './Routes';
import NavSidebar from './NavSidebar';

import './App.scss';
import { useHistory } from 'react-router';
import { useSegmentIOTracking } from '../utilities/segmentIOTrackingUtils';

const App: React.FC = () => {
  const isDeskTop = useDesktopWidth();
  const [isNavOpen, setIsNavOpen] = React.useState(isDeskTop);
  const dispatch = useDispatch();
  const history = useHistory();

  React.useEffect(() => {
    dispatch(detectUser());
  }, [dispatch]);

  React.useEffect(() => {
    setIsNavOpen(isDeskTop);
  }, [isDeskTop]);

  const onNavToggle = () => {
    setIsNavOpen(!isNavOpen);
  };

  const TrackInteraction = React.memo(() => {
    // notify url change events
    React.useEffect(() => {
      let { pathname } = history.location;
      const unlisten = history.listen((location) => {
        const { pathname: nextPathname } = history.location;
        if (pathname !== nextPathname) {
          pathname = nextPathname;
          useSegmentIOTracking('page');
        }
      });
      return () => unlisten();
    }, [useSegmentIOTracking]);
  
    return null;
  });

  return (
    <Page
      className="odh-dashboard"
      header={<Header isNavOpen={isNavOpen} onNavToggle={onNavToggle} />}
      sidebar={<NavSidebar isNavOpen={isNavOpen} />}
    >
      <TrackInteraction />
      <Routes />
    </Page>
  );
};

export default App;
