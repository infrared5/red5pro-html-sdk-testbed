(function(window, document, red5prosdk) {
  'use strict';

  var isMoz = false;
  if (window.adapter) {
    isMoz = window.adapter.browserDetails.browser.toLowerCase() === 'firefox';
  }

  var serverSettings = (function() {
    var settings = sessionStorage.getItem('r5proServerSettings');
    try {
      return JSON.parse(settings);
    }
    catch (e) {
      console.error('Could not read server settings from sessionstorage: ' + e.message);
    }
    return {};
  })();

  var configuration = (function () {
    var conf = sessionStorage.getItem('r5proTestBed');
    try {
      return JSON.parse(conf);
    }
    catch (e) {
      console.error('Could not read testbed configuration from sessionstorage: ' + e.message);
    }
    return {}
  })();
  red5prosdk.setLogLevel(configuration.verboseLogging ? red5prosdk.LOG_LEVELS.TRACE : red5prosdk.LOG_LEVELS.WARN);

  var targetSubscriber;

  var updateStatusFromEvent = window.red5proHandleSubscriberEvent; // defined in src/template/partial/status-field-subscriber.hbs
  var instanceId = Math.floor(Math.random() * 0x10000).toString(16);
  var streamTitle = document.getElementById('stream-title');
  var statisticsField = document.getElementById('statistics-field');

  var protocol = serverSettings.protocol;
  var isSecure = protocol === 'https';

  var bitrate = 0;
  var packetsReceived = 0;
  var frameWidth = 0;
  var frameHeight = 0;
  function updateStatistics (b, p, w, h) {
    statisticsField.innerText = 'Bitrate: ' + Math.floor(b) + '. Packets Received: ' + p + '.' + ' Resolution: ' + w + ', ' + h + '.';
  }

  function onBitrateUpdate (b, p) {
    bitrate = b;
    packetsReceived = p;
    updateStatistics(bitrate, packetsReceived, frameWidth, frameHeight);
  }

  function onResolutionUpdate (w, h) {
    frameWidth = w;
    frameHeight = h;
    updateStatistics(bitrate, packetsReceived, frameWidth, frameHeight);
  }

  // Determines the ports and protocols based on being served over TLS.
  function getSocketLocationFromProtocol () {
    return !isSecure
      ? {protocol: 'ws', port: serverSettings.wsport}
      : {protocol: 'wss', port: serverSettings.wssport};
  }

  // Base configuration to extend in providing specific tech failover configurations.
  var defaultConfiguration = (function(useVideo, useAudio) {
    var c = {
      protocol: getSocketLocationFromProtocol().protocol,
      port: getSocketLocationFromProtocol().port
    };
    if (!useVideo) {
      c.videoEncoding = red5prosdk.PlaybackVideoEncoder.NONE;
    }
    if (!useAudio) {
      c.audioEncoding = red5prosdk.PlaybackAudioEncoder.NONE;
    }
    return c;
  })(configuration.useVideo, configuration.useAudio);

  // Local lifecycle notifications.
  function onSubscriberEvent (event) {
    if (event.type !== 'Subscribe.Time.Update') {
      console.log('[Red5ProSubscriber] ' + event.type + '.');
      updateStatusFromEvent(event);
      if (event.type === 'Subscribe.Metadata') {
        handleStreamingModeMetadata(event.data, targetSubscriber.getType());
      }
    }
  }
  function onSubscribeFail (message) {
    console.error('[Red5ProSubsriber] Subscribe Error :: ' + message);
  }
  function onSubscribeSuccess (subscriber) {
    console.log('[Red5ProSubsriber] Subscribe Complete.');
    if (window.handleSubscriberSetupGlobally) {
      window.handleSubscriberSetupGlobally(subscriber);
    }
    if (subscriber.getType().toLowerCase() === 'rtc') {
      try {
        window.trackBitrate(subscriber.getPeerConnection(), onBitrateUpdate, onResolutionUpdate, true);
      }
      catch (e) {
        //
      }
    }
  }
  function onUnsubscribeFail (message) {
    console.error('[Red5ProSubsriber] Unsubscribe Error :: ' + message);
  }
  function onUnsubscribeSuccess () {
    console.log('[Red5ProSubsriber] Unsubscribe Complete.');
  }

  function getAuthenticationParams () {
    var auth = configuration.authentication;
    return auth && auth.enabled
      ? {
        connectionParams: {
          username: auth.username,
          password: auth.password
        }
      }
      : {};
  }

  // Request to unsubscribe.
  function unsubscribe () {
    return new Promise(function(resolve, reject) {
      var subscriber = targetSubscriber
      if (window.handleSubscriberTeardownGlobally) {
        window.handleSubscriberTeardownGlobally(subscriber);
      }
      subscriber.unsubscribe()
        .then(function () {
          targetSubscriber.off('*', onSubscriberEvent);
          targetSubscriber = undefined;
          onUnsubscribeSuccess();
          resolve();
        })
        .catch(function (error) {
          var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
          onUnsubscribeFail(jsonError);
          reject(error);
        });
    });
  }

  // Define tech spefific configurations for each failover item.
  var config = Object.assign({},
    configuration,
    defaultConfiguration,
    getAuthenticationParams());
  var rtcConfig = Object.assign({}, config, {
    protocol: getSocketLocationFromProtocol().protocol,
    port: getSocketLocationFromProtocol().port,
    subscriptionId: 'subscriber-' + instanceId,
    streamName: config.stream1,
  })

  // Request to initialization and start subscribing through failover support.
  var subscriber = new red5prosdk.RTCSubscriber()
  subscriber.init(rtcConfig)
    .then(function (subscriberImpl) {
      streamTitle.innerText = configuration.stream1;
      targetSubscriber = subscriberImpl
      // Subscribe to events.
      targetSubscriber.on('*', onSubscriberEvent);
      return targetSubscriber.subscribe()
    })
    .then(function () {
      onSubscribeSuccess(targetSubscriber);
    })
    .catch(function (error) {
      var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
      console.error('[Red5ProSubscriber] :: Error in subscribing - ' + jsonError);
      onSubscribeFail(jsonError);
    });

  var streamingMode;
  var audioSubscriberDecoy;
  function handleStreamingModeMetadata (metadata) {
    if (isMoz) return; // It works in Firefox!

    var volumeHandler = function (event) {
      if (audioSubscriberDecoy) {
        audioSubscriberDecoy.setVolume(event.data.volume)
      }
    }
    if (streamingMode !== metadata.streamingMode) {
      var previousStreamingMode = streamingMode;
      streamingMode = metadata.streamingMode;
      if (streamingMode === 'Audio' && previousStreamingMode === undefined) {
        // Then, we have started playback of an Audio only stream because
        // the broadcaster has turned off their Camera stream.
        // There is a bug in some browsers that will not allow A/V bundled streams
        // to playback JUST audio on initial subscription in a <video> element; they only allow <audio>.
        addAudioSubscriberDecoy(function (subscriber) {
          audioSubscriberDecoy = subscriber;
          targetSubscriber.on('Subscribe.Volume.Change', volumeHandler)
        });
      } else if (audioSubscriberDecoy) {
        removeAudioSubscriberDecoy(audioSubscriberDecoy);
        targetSubscriber.off('Subscribe.Volume.Change', volumeHandler)
        audioSubscriberDecoy = undefined;
      }
    }
  }

  function addAudioSubscriberDecoy (cb) {
    var extension = {
      mediaElementId: 'red5pro-audio-subscriber',
      subscriptionId: 'subscriber-' + Math.floor(Math.random() * 0x10000).toString(16)
    };
    new red5prosdk.RTCSubscriber()
      .init(Object.assign(rtcConfig, extension))
      .then(function (aSubscriber) {
        cb(aSubscriber)
        return aSubscriber.subscribe();
      })
      .catch(function (error) {
        console.log(error);
      });
  }

  function removeAudioSubscriberDecoy (decoy) {
    decoy.unsubscribe();
  }

  // Clean up.
  var shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    function clearRefs () {
      if (targetSubscriber) {
        targetSubscriber.off('*', onSubscriberEvent);
      }
      targetSubscriber = undefined;
    }
    unsubscribe().then(clearRefs).catch(clearRefs);
    window.untrackBitrate();
  }
  window.addEventListener('pagehide', shutdown);
  window.addEventListener('beforeunload', shutdown);

})(this, document, window.red5prosdk);

