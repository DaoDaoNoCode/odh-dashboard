import * as React from 'react';
import { Button, ActionList, ActionListItem } from '@patternfly/react-core';
import ApplicationsPage from '../ApplicationsPage';
import SpawnerPage from './SpawnerPage';
import NotebookServerDetails from './NotebookServerDetails';
import AppContext from 'app/AppContext';
import { useWatchImages } from 'utilities/useWatchImages';
import { useWatchDashboardConfig } from 'utilities/useWatchDashboardConfig';
import { useWatchNotebook } from 'utilities/useWatchNotebook';
import { deleteNotebook } from 'services/notebookService';
import { useSelector } from 'react-redux';
import { State } from 'redux/types';
import { generateNotebookNameFromUsername } from 'utilities/utils';

export const NotebookController: React.FC = React.memo(() => {
  const { setIsNavOpen } = React.useContext(AppContext);
  const { images } = useWatchImages();
  const { dashboardConfig } = useWatchDashboardConfig();
  const { notebook, loaded, loadError, forceUpdate: updateNotebook } = useWatchNotebook();
  const username = useSelector<State, string>((state) => state.appState.user || '');
  const isEmpty = !notebook;

  React.useEffect(() => {
    setIsNavOpen(false);
  }, [setIsNavOpen]);

  return (
    <ApplicationsPage
      title={isEmpty ? 'Start a Notebook server' : 'Notebook server control panel'}
      description={isEmpty ? 'Select options for your Notebook server.' : null}
      loaded={loaded}
      loadError={loadError}
      empty={isEmpty}
      emptyStatePage={<SpawnerPage images={images} odhConfig={dashboardConfig} updateNotebook={updateNotebook} />}
    >
      {notebook && 
        <div className="odh-notebook-controller__page">
          <ActionList>
            <ActionListItem onClick={() => {
              deleteNotebook(generateNotebookNameFromUsername(username))
                .then(() =>{
                  updateNotebook();
                })
                .catch(e => console.log(e));
            }}>
              <Button variant="primary">Stop notebook server</Button>
            </ActionListItem>
            <ActionListItem>
              <Button variant="secondary" onClick={() => {
                window.open(notebook.metadata.annotations?.['opendatahub.io/link'], '_blank')
              }}>Return to server</Button>
            </ActionListItem>
          </ActionList>
          <NotebookServerDetails notebook={notebook} images={images}/>
        </div>
      }
    </ApplicationsPage>
  );
});

NotebookController.displayName = 'NotebookController';

export default NotebookController;
