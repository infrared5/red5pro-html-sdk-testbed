(function(window, document, red5pro, PublisherBase, SubscriberBase /* see: src/static/script/main.js */) {
  'use strict';

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

  var targetPublisher;
  var targetPubView;

  var pubStatusField = document.getElementById('pub-status-field');
  var pubStreamTitle = document.getElementById('pub-stream-title');

  var targetSubscriber;
  var targetSubView;

  var subStatusField = document.getElementById('sub-status-field');
  var subStreamTitle = document.getElementById('sub-stream-title');

  var instanceId = Math.floor(Math.random() * 0x10000).toString(16);
  var protocol = serverSettings.protocol;
  var isSecure = protocol === 'https';
  function getSocketLocationFromProtocol () {
    return !isSecure
      ? {protocol: 'ws', port: serverSettings.wsport}
      : {protocol: 'wss', port: serverSettings.wssport};
  }

  var defaultSubscriberConfiguration = (function(useVideo, useAudio) {
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

  var updateStatusFromPublishEvent = window.red5proHandlePublisherEvent; // defined in src/template/partial/status-field-publisher.hbs
  var updateStatusFromSubscribeEvent = window.red5proHandleSubscriberEvent; // defined in src/template/partial/status-field-subscriber.hbs

  function onPublisherEvent (event) {
    console.log('[Red5ProPublisher] ' + event.type + '.');
    updateStatusFromPublishEvent(event, pubStatusField);
  }
  function onPublishFail (message) {
    console.error('[Red5ProPublisher] Publish Error :: ' + message);
  }
  function onPublishSuccess () {
    console.log('[Red5ProPublisher] Publish Complete.');
  }
  function onUnpublishFail (message) {
    console.error('[Red5ProPublisher] Unpublish Error :: ' + message);
  }
  function onUnpublishSuccess () {
    console.log('[Red5ProPublisher] Unpublish Complete.');
  }
  function onSubscriberEvent (event) {
    console.log('[Red5ProSubsriber] ' + event.type + '.');
    updateStatusFromSubscribeEvent(event, subStatusField);
  }
  function onSubscribeFail (message) {
    console.error('[Red5ProSubsriber] Subscribe Error :: ' + message);
  }
  function onSubscribeSuccess () {
    console.log('[Red5ProSubsriber] Subscribe Complete.');
  }
  function onUnsubscribeFail (message) {
    console.error('[Red5ProSubsriber] Unsubscribe Error :: ' + message);
  }
  function onUnsubscribeSuccess () {
    console.log('[Red5ProSubsriber] Unsubscribe Complete.');
  }

  function getUserMediaConfiguration () {
    return {
      audio: configuration.useAudio ? configuration.userMedia.audio : false,
      video: configuration.useVideo ? configuration.userMedia.video : false
    };
  }

  function determinePublisher () {

    var config = Object.assign({},
                   configuration,
                  {mediaConstraints: getUserMediaConfiguration()});
    var rtcConfig = Object.assign({}, config, {
                      protocol: getSocketLocationFromProtocol().protocol,
                      port: getSocketLocationFromProtocol().port,
                      streamName: config.stream1,
                      streamType: 'webrtc'
                   });
    var rtmpConfig = Object.assign({}, config, {
                      protocol: 'rtmp',
                      port: serverSettings.rtmpport,
                      streamName: config.stream1,
                      swf: '../../lib/red5pro/red5pro-publisher.swf',
                      swfobjectURL: '../../lib/swfobject/swfobject.js',
                      productInstallURL: '../../lib/swfobject/playerProductInstall.swf',
                      mediaConstraints: {
                        width: config.cameraWidth,
                        height: config.cameraHeight,
                      }
                   });
    var publishOrder = config.publisherFailoverOrder
                            .split(',')
                            .map(function (item) {
                              return item.trim()
                        });

    return PublisherBase.determinePublisher({
                rtc: rtcConfig,
                rtmp: rtmpConfig
              }, publishOrder);
  }

  function preview (publisher) {
    var elementId = 'red5pro-publisher-video';
    return PublisherBase.preview(publisher, elementId);
  }

  function publish (publisher, view, streamName) {
    pubStreamTitle.innerText = streamName;
    targetPublisher = publisher;
    targetPubView = view;
    return new Promise(function (resolve, reject) {
      PublisherBase.publish(publisher, streamName)
       .then(function () {
          onPublishSuccess(publisher);
          resolve();
        })
        .catch(function (error) {
          reject(error);
        })
    });
  }

  function unpublish () {
    return new Promise(function (resolve, reject) {
      var view = targetPubView;
      var publisher = targetPublisher;
      PublisherBase.unpublish(publisher, view)
        .then(function () {
          onUnpublishSuccess();
          resolve();
        })
        .catch(function (error) {
          var jsonError = typeof error === 'string' ? error : JSON.stringify(error, 2, null);
          onUnpublishFail('Unmount Error ' + jsonError);
          reject(error);
        });
    });
  }

  function beginStreamListCall () {

    var host = configuration.host;
    var port = serverSettings.httpport;
    var portURI = (port.length > 0 ? ':' + port : '');
    var baseUrl = isSecure ? protocol + '://' + host : protocol + '://' + host + portURI;
    var url = baseUrl + '/' + configuration.app + '/streams.jsp';
    fetch(url)
      .then(function (res) {
        if (res.headers.get('content-type') &&
            res.headers.get('content-type').toLowerCase().indexOf('application/json') >= 0) {
          return res.json();
        }
        else {
          return res.text();
        }
      })
      .then(function (jsonOrString) {
        var json = jsonOrString;
        if (typeof jsonOrString === 'string') {
          try {
            json = JSON.parse(json);
          }
          catch(e) {
            throw new TypeError('Could not properly parse response: ' + e.message);
          }
        }
        recieveList(json);
      })
      .catch(function (error) {
        var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
        console.error('[Two-Way] :: Error - Could not request Stream List. ' + jsonError);
        listError(error);
       });

  }

  function recieveList (listIn) {
    var found = false;

    for (var i = listIn.length - 1; i >= 0; i--) {
      found = listIn[i].name == configuration.stream2;
      if(found) break;
    }

    if (found) {
      startSubscribing();
    }
    else {
      setWaitTime();
    }
  }

  function listError (err) {
    console.log( "Error recieved on streamListCall - " + err );
    setWaitTime();
  }

  function setWaitTime () {
    setTimeout(beginStreamListCall, 5000);
  }

  function startSubscribing () {
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
        return subscribe(subscriber, view, configuration.stream2);
      })
      .catch(function (error) {
        var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
        console.error('[Red5ProSubscriber] :: Error in subscribing - ' + jsonError);
        onSubscribeFail(jsonError);
      });
  }

  function determineSubscriber () {
    var config = Object.assign({}, configuration, defaultSubscriberConfiguration);
    var rtcConfig = Object.assign({}, config, {
      protocol: getSocketLocationFromProtocol().protocol,
      port: getSocketLocationFromProtocol().port,
      subscriptionId: 'subscriber-' + instanceId,
      streamName: config.stream2,
      bandwidth: {
        audio: 50,
        video: 256,
        data: 30 * 1000 * 1000
      }
    })
    var rtmpConfig = Object.assign({}, config, {
      protocol: 'rtmp',
      port: serverSettings.rtmpport,
      streamName: config.stream2,
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
      streamName: config.stream2,
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
    subStreamTitle.innerText = streamName;
    targetSubscriber = subscriber;
    targetSubView = view;
    if (targetSubscriber.getType().toLowerCase() === 'hls') {
      targetSubView.view.classList.add('video-js', 'vjs-default-skin')
    }
    // Initiate playback.
    return new Promise(function (resolve, reject) {
      SubscriberBase.subscribe(subscriber, view)
        .then(function () {
          onSubscribeSuccess();
          resolve();
        })
        .catch(reject);
    });
  }

  // Request to unsubscribe.
  function unsubscribe () {
    return new Promise(function(resolve, reject) {
      var view = targetSubView
      var subscriber = targetSubscriber
      SubscriberBase.unsubscribe(subscriber, view)
        .then(function () {
          targetSubscriber.off('*', onSubscriberEvent);
          targetSubscriber = undefined;
          targetSubView = undefined;
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
  determinePublisher()
    .then(function (payload) {
      var requiresPreview = payload.requiresPreview;
      var publisher = payload.publisher;
      publisher.on('*', onPublisherEvent);
      return preview(publisher, requiresPreview);
    })
    .then(function (payload) {
      var publisher = payload.publisher;
      var view = payload.view;
      return publish(publisher, view, configuration.stream1);
    })
    .then(function () {
      beginStreamListCall();
    })
    .catch(function (error) {
      var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
      console.error('[Red5ProPublisher] :: Error in publishing - ' + jsonError);
      onPublishFail(jsonError);
     });

  window.addEventListener('beforeunload', function() {
    function clearRefs () {
      if (targetPublisher) {
        targetPublisher.off('*', onPublisherEvent);
      }
      if (targetSubscriber) {
        targetSubscriber.off('*', onSubscriberEvent);
      }
      targetPubView = targetPublisher = undefined;
      targetSubscriber = targetSubView = undefined;
    }
    unpublish().then(unsubscribe).then(clearRefs).catch(clearRefs);
  });

})(this, document, window.red5prosdk, new window.R5ProBase.Publisher(), new window.R5ProBase.Subscriber());

