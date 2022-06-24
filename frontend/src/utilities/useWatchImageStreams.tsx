import * as React from 'react';
import { ImageStream, ImageStreamList } from '../types';
import { POLL_INTERVAL } from './const';
import { getImageStreams } from 'services/imageStreamsService';

export const useWatchImageStreams = (): {
  imageStreams: ImageStream[];
  loaded: boolean;
  loadError: Error | undefined;
} => {
  const [loaded, setLoaded] = React.useState<boolean>(false);
  const [loadError, setLoadError] = React.useState<Error>();
  const [imageStreams, setImageStreams] = React.useState<ImageStream[]>([]);

  React.useEffect(() => {
    let watchHandle;
    const watchImageStreams = () => {
      getImageStreams()
        .then((data: ImageStreamList) => {
          setLoaded(true);
          setLoadError(undefined);
          setImageStreams(data.items ?? []);
        })
        .catch((e) => {
          setLoadError(e);
        });
      watchHandle = setTimeout(watchImageStreams, POLL_INTERVAL);
    };
    watchImageStreams();

    return () => {
      if (watchHandle) {
        clearTimeout(watchHandle);
      }
    };
    // Don't update when components are updated
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { imageStreams, loaded, loadError };
};
