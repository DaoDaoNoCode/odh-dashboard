import * as React from 'react';
import { Notebook } from '../types';
import { POLL_INTERVAL } from './const';
import { getNotebook } from 'services/notebookService';
import { useSelector } from 'react-redux';
import { State } from 'redux/types';
import { generateNotebookNameFromUsername } from './utils';

export const useWatchNotebook = (): {
  notebook: Notebook | undefined;
  loaded: boolean;
  loadError: Error | undefined;
  forceUpdate: () => void;
} => {
  const [loaded, setLoaded] = React.useState<boolean>(false);
  const [loadError, setLoadError] = React.useState<Error>();
  const [notebook, setNotebook] = React.useState<Notebook>();
  const username = useSelector<State, string>((state) => state.appState.user || '');

  const forceUpdate = () => {
    if (username) {
      setLoaded(false);
      const notebookName = generateNotebookNameFromUsername(username);
      getNotebook(notebookName)
        .then((data: Notebook) => {
          setLoaded(true);
          setLoadError(undefined);
          setNotebook(data);
        })
        .catch((e) => {
          setLoadError(e);
        });
    }
  };

  React.useEffect(() => {
    let watchHandle;
    const watchNotebook = (notebookName: string) => {
      getNotebook(notebookName)
        .then((data: Notebook) => {
          setLoaded(true);
          setLoadError(undefined);
          setNotebook(data);
        })
        .catch((e) => {
          setLoadError(e);
        });
      watchHandle = setTimeout(() => watchNotebook(notebookName), POLL_INTERVAL);
    };
    if (username) {
      const notebookName = generateNotebookNameFromUsername(username);
      watchNotebook(notebookName);
    }

    return () => {
      if (watchHandle) {
        clearTimeout(watchHandle);
      }
    };
    // Don't update when components are updated
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  return { notebook, loaded, loadError, forceUpdate };
};
