export const fireTrackingEvent = (eventType: string, properties?: any) => {
  const clusterID = window.clusterID ?? '';
  if (window.analytics) {
    switch (eventType) {
      case 'identify':
        window.analytics.identify(properties, { clusterID });
        break;
      case 'page':
        window.analytics.page(undefined, { clusterID });
        break;
      default:
        window.analytics.track(eventType, {...properties, clusterID});
    }
  }
}

export const initSegment = async (props) => {
  const { segmentKey, username } = props;
  const analytics = (window.analytics = window.analytics || []);
  if (analytics.initialize) {
    return;
  }
  if (analytics.invoked)
    window.console && console.error && console.error('Segment snippet included twice.');
  else {
    analytics.invoked = true;
    analytics.methods = [
      'trackSubmit',
      'trackClick',
      'trackLink',
      'trackForm',
      'pageview',
      'identify',
      'reset',
      'group',
      'track',
      'ready',
      'alias',
      'debug',
      'page',
      'once',
      'off',
      'on',
      'addSourceMiddleware',
      'addIntegrationMiddleware',
      'setAnonymousId',
      'addDestinationMiddleware',
    ];
    analytics.factory = function(e: string) {
      return function() {
        let t = Array.prototype.slice.call(arguments);
        t.unshift(e);
        analytics.push(t);
        return analytics;
      };
    };
    for (let e = 0; e < analytics.methods.length; e++) {
      let key = analytics.methods[e];
      analytics[key] = analytics.factory(key);
    }
    analytics.load = function(key: string, e: Event) {
      const t = document.createElement('script');
      t.type = 'text/javascript';
      t.async = true;
      t.src = 'https://cdn.segment.com/analytics.js/v1/' + encodeURIComponent(key) + '/analytics.min.js';
      const n = document.getElementsByTagName('script')[0];
      if (n.parentNode) {
        n.parentNode.insertBefore(t, n);
      }
      analytics._loadOptions = e;
    };
    analytics.SNIPPET_VERSION = '4.13.1';
    if (segmentKey) {
      analytics.load(segmentKey);
    }
    const anonymousIdBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(username));
    const anonymousIdArray = Array.from(new Uint8Array(anonymousIdBuffer));
    const anonymousId = anonymousIdArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    fireTrackingEvent('identify', anonymousId);
    fireTrackingEvent('page');
  }
};
