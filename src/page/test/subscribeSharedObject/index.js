(function(window, document, red5pro, SubscriberBase) {
  'use strict';

  var SharedObject = red5pro.Red5ProSharedObject;
  var so = undefined; // @see onSubscribeSuccess

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

  var targetSubscriber;
  var targetView;

  var updateStatusFromEvent = window.red5proHandleSubscriberEvent; // defined in src/template/partial/status-field-subscriber.hbs
  var instanceId = Math.floor(Math.random() * 0x10000).toString(16);
  var streamTitle = document.getElementById('stream-title');
  var sendButton = document.getElementById('send-button');
  var soField = document.getElementById('so-field');
  sendButton.addEventListener('click', function () {
    sendMessageOnSharedObject(document.getElementById('input-field').value);
  });
  var protocol = serverSettings.protocol;
  var isSecure = protocol === 'https';
  function getSocketLocationFromProtocol () {
    return !isSecure
      ? {protocol: 'ws', port: serverSettings.wsport}
      : {protocol: 'wss', port: serverSettings.wssport};
  }

  var defaultConfiguration = (function(useVideo, useAudio) {
    var c = {
      protocol: getSocketLocationFromProtocol().protocol,
      port: getSocketLocationFromProtocol().port,
      app: 'live',
      bandwidth: {
        audio: 50,
        video: 256,
        data: 30 * 1000 * 1000
      }
    };
    if (!useVideo) {
      c.videoEncoding = red5pro.PlaybackVideoEncoder.NONE;
    }
    if (!useAudio) {
      c.audioEncoding = red5pro.PlaybackAudioEncoder.NONE;
    }
    return c;
  })(configuration.useVideo, configuration.useAudio);

  // Local lifecycle notifications.
  function onSubscriberEvent (event) {
    console.log('[Red5ProSubscriber] ' + event.type + '.');
    updateStatusFromEvent(event);
  }
  function onSubscribeFail (message) {
    console.error('[Red5ProSubsriber] Subscribe Error :: ' + message);
  }
  function onSubscribeSuccess (subscriber) {
    console.log('[Red5ProSubsriber] Subscribe Complete.');
    establishSharedObject(subscriber);
  }
  function onUnsubscribeFail (message) {
    console.error('[Red5ProSubsriber] Unsubscribe Error :: ' + message);
  }
  function onUnsubscribeSuccess () {
    console.log('[Red5ProSubsriber] Unsubscribe Complete.');
  }

  var hasRegistered = false;
  function appendMessage (message) {
    soField.value = [message, soField.value].join('\n');
  }
  // Invoked from METHOD_UPDATE event on Shared Object instance.
  function messageTransmit (message) { // eslint-disable-line no-unused-vars
    soField.value = ['User "' + message.user + '": ' + message.message, soField.value].join('\n');
  }
  function establishSharedObject (subscriber) {
    // Create new shared object.
    so = new SharedObject('sharedChatTest', subscriber);
    var soCallback = {
      messageTransmit: messageTransmit
    };
    so.on(red5pro.SharedObjectEventTypes.CONNECT_SUCCESS, function (event) { // eslint-disable-line no-unused-vars
      console.log('[Red5ProSubscriber] SharedObject Connect.');
      appendMessage('Connected.');
    });
    so.on(red5pro.SharedObjectEventTypes.CONNECT_FAILURE, function (event) { // eslint-disable-line no-unused-vars
      console.log('[Red5ProSubscriber] SharedObject Fail.');
    });
    so.on(red5pro.SharedObjectEventTypes.PROPERTY_UPDATE, function (event) {
      console.log('[Red5ProPublisher] SharedObject Property Update.');
      console.log(JSON.stringify(event.data, null, 2));
      if (event.data.hasOwnProperty('count')) {
        appendMessage('User count is: ' + event.data.count + '.');
        if (!hasRegistered) {
          hasRegistered = true;
          so.setProperty('count', parseInt(event.data.count) + 1);
        }
      else if (!hasRegistered) {
          hasRegistered = true;
          so.setProperty('count', 1);
        }
      }
    });
    so.on(red5pro.SharedObjectEventTypes.METHOD_UPDATE, function (event) {
      console.log('[Red5ProPublisher] SharedObject Method Update.');
      console.log(JSON.stringify(event.data, null, 2));
      soCallback[event.data.methodName].call(null, event.data.message);
    });
  }

  function sendMessageOnSharedObject (message) {
    so.send('messageTransmit', {
      user: [configuration.stream1, 'subscriber'].join(' '),
      message: message
    });
  }

  function determineSubscriber () {
    var config = Object.assign({}, configuration, defaultConfiguration);
    var rtcConfig = Object.assign({}, config, {
      protocol: getSocketLocationFromProtocol().protocol,
      port: getSocketLocationFromProtocol().port,
      subscriptionId: 'subscriber-' + instanceId,
      streamName: config.stream1,
      bandwidth: {
        audio: 50,
        video: 256,
        data: 30 * 1000 * 1000
      }
    })
    var rtmpConfig = Object.assign({}, config, {
      protocol: 'rtmp',
      port: serverSettings.rtmpport,
      streamName: config.stream1,
      mimeType: 'rtmp/flv',
      useVideoJS: false,
      width: config.cameraWidth,
      height: config.cameraHeight,
      swf: '../../lib/red5pro/red5pro-subscriber.swf',
      swfobjectURL: '../../lib/swfobject/swfobject.js',
      productInstallURL: '../../lib/swfobject/playerProductInstall.swf'
    })
    var hlsConfig = Object.assign({}, config, {
      protocol: protocol,
      port: isSecure ? serverSettings.hlssport : serverSettings.hlsport,
      streamName: config.stream1,
      mimeType: 'application/x-mpegURL',
      swf: '../../lib/red5pro/red5pro-video-js.swf',
      swfobjectURL: '../../lib/swfobject/swfobject.js',
      productInstallURL: '../../lib/swfobject/playerProductInstall.swf'
    })

    if (!config.useVideo) {
      rtcConfig.videoEncoding = 'NONE';
    }
    if (!config.useAudio) {
      rtcConfig.audioEncoding = 'NONE';
    }

    var subscribeOrder = config.subscriberFailoverOrder
                          .split(',').map(function (item) {
                            return item.trim();
                            });

    return SubscriberBase.determineSubscriber({
              rtc: rtcConfig,
              rtmp: rtmpConfig,
              hls: hlsConfig
            }, subscribeOrder);
  }

  function view (subscriber) {
    var elementId = 'red5pro-subscriber-video';
    return SubscriberBase.view(subscriber, elementId);
  }

  // Request to start subscribing using an overlayed configuration from local default and local storage.
  function subscribe (subscriber, view, streamName) {
    streamTitle.innerText = streamName;
    targetSubscriber = subscriber;
    targetView = view;
    if (targetSubscriber.getType().toLowerCase() === 'hls') {
      targetView.view.classList.add('video-js', 'vjs-default-skin')
    }
    // Initiate playback.
    return new Promise(function (resolve, reject) {
      SubscriberBase.subscribe(subscriber, view)
        .then(function () {
          onSubscribeSuccess(subscriber);
          resolve();
        })
        .catch(reject);
    });
  }

  // Request to unsubscribe.
  function unsubscribe () {
    if (so !== undefined) {
      so.close();
    }
    return new Promise(function(resolve, reject) {
      var view = targetView
      var subscriber = targetSubscriber
      SubscriberBase.unsubscribe(subscriber, view)
        .then(function () {
          targetSubscriber.off('*', onSubscriberEvent);
          targetSubscriber = undefined;
          targetView = undefined;
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

  // Kick off.
  determineSubscriber()
    .then(function(payload) {
      var subscriber = payload.subscriber;
      // Subscribe to events.
      subscriber.on('*', onSubscriberEvent);
      return view(subscriber);
    })
    .then(function(payload) {
      var subscriber = payload.subscriber;
      var view = payload.view;
      return subscribe(subscriber, view, configuration.stream1);
    })
    .catch(function (error) {
      var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
      console.error('[Red5ProSubscriber] :: Error in subscribing - ' + jsonError);
      onSubscribeFail(jsonError);
    });

  // Clean up.
  window.addEventListener('beforeunload', function() {
    function clearRefs () {
      if (targetSubscriber) {
        targetSubscriber.off('*', onSubscriberEvent);
      }
      targetSubscriber = targetView = undefined;
    }
    unsubscribe().then(clearRefs).catch(clearRefs);
  });

})(this, document, window.red5prosdk, new window.R5ProBase.Subscriber());

