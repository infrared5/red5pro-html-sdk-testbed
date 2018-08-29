(function(window, document, red5prosdk, sm_ext) {
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
  red5prosdk.setLogLevel(configuration.verboseLogging ? red5prosdk.LOG_LEVELS.TRACE : red5prosdk.LOG_LEVELS.WARN);

  // Stream Manager Extension Lib.
  sm_ext.setLogLevel(configuration.verboseLogging ? red5prosdk.LOG_LEVELS.TRACE : red5prosdk.LOG_LEVELS.WARN);
  // Extend the Red5Pro sdk.
  sm_ext.decorate();

  var targetPublisher;

  var updateStatusFromEvent = window.red5proHandlePublisherEvent; // defined in src/template/partial/status-field-publisher.hbs
  var streamTitle = document.getElementById('stream-title');
  var statisticsField = document.getElementById('statistics-field');
  var addressField = document.getElementById('address-field');
  var usernameField = document.getElementById('username-field');
  var passwordField = document.getElementById('password-field');
  var customerField = document.getElementById('customer-field');
  var recordingField = document.getElementById('recording-field');
  var metaField = document.getElementById('meta-field');
  var submitButton = document.getElementById('submit-button');
  var stopButton = document.getElementById('stop-button');
  var websocketField = document.getElementById('websocket-field');

  var protocol = serverSettings.protocol;
  var isSecure = protocol == 'https';
  function getSocketLocationFromProtocol () {
    return !isSecure
      ? {protocol: 'ws', port: serverSettings.wsport}
      : {protocol: 'wss', port: serverSettings.wssport};
  }

  var defaultConfiguration = {
    protocol: getSocketLocationFromProtocol().protocol,
    port: getSocketLocationFromProtocol().port
  };

  function displayServerAddress (serverAddress, proxyAddress) 
  {
  proxyAddress = (typeof proxyAddress === 'undefined') ? 'N/A' : proxyAddress;
    addressField.innerText = ' Proxy Address: ' + proxyAddress + ' | ' + ' Origin Address: ' + serverAddress;
  }

  function onBitrateUpdate (bitrate, packetsSent) {
    statisticsField.innerText = 'Bitrate: ' + Math.floor(bitrate) + '. Packets Sent: ' + packetsSent + '.';
  }

  function onPublisherEvent (event) {
    console.log('[Red5ProPublisher] ' + event.type + '.');
    updateStatusFromEvent(event);
  }
  function onPublishFail (message) {
    console.error('[Red5ProPublisher] Publish Error :: ' + message);
  }
  function onPublishSuccess (publisher) {
    console.log('[Red5ProPublisher] Publish Complete.');
    try {
      window.trackBitrate(publisher.getPeerConnection(), onBitrateUpdate);
    }
    catch (e) {
      //
    }
  }
  function onUnpublishFail (message) {
    console.error('[Red5ProPublisher] Unpublish Error :: ' + message);
  }
  function onUnpublishSuccess () {
    console.log('[Red5ProPublisher] Unpublish Complete.');
  }

  function notifyWebAppOfUnpublish (url) {
    var json = getConnectionParamsForPublishStop();
    fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(json)
      })
      .then(function (res) {
        if (res.headers.get("content-type") &&
          res.headers.get("content-type").toLowerCase().indexOf("application/json") >= 0) {
            return res.json();
        }
        else {
          throw new TypeError('Could not properly parse response.');
        }
      })
      .then(function () {
        console.log('[PublisherWebHookStreamManagerTest] :: Unpublish notify sent successfully.')
      })
      .catch(function (error) {
        var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2)
        console.error('[PublisherWebHookStreamManagerTest] :: Error - Could not POST Unpublish notification. ' + jsonError)
      });
  }

  function getUserMediaConfiguration () {
    return {
      mediaConstraints: {
        audio: configuration.useAudio ? configuration.mediaConstraints.audio : false,
        video: configuration.useVideo ? configuration.mediaConstraints.video : false
      }
    };
  }

  function getRTMPMediaConfiguration () {
    return {
      mediaConstraints: {
        audio: configuration.useAudio ? configuration.mediaConstraints.audio : false,
        video: configuration.useVideo ? {
                width: configuration.cameraWidth,
                height: configuration.cameraHeight
              } : false
      }
    }
  }

  function getConnectionParamsFromFormFields () {
    var optionalMeta;
    var metaValue = metaField.value;
    try {
      optionalMeta = JSON.stringify(JSON.parse(metaValue));
    } catch (e) {
      console.error('Could not determine meta JSON from: ' + metaValue);
      console.error(e);
    }
    return {
      username: usernameField.value || undefined,
      password: passwordField.value || undefined,
      customerscope: customerField.value,
      recording: recordingField.checked,
      meta: optionalMeta || {}
    };
  }

  function getConnectionParamsForPublishStop () {
    return {
      customerscope: customerField.value,
      streamName: configuration.stream1
    }
  }

  function determinePublisher () {

    var autoscaleConfig = {
      protocol: protocol,
      host: configuration.host,
      streamName: configuration.stream1,
      scope: configuration.app,
      apiVersion: configuration.streamManagerAPI || '3.0',
      action: 'broadcast',
      useProxy: true,
      retryLimit: 3,
      retryDelay: 2000,
      accessToken: configuration.streamManagerAccessToken
    };

    var config = Object.assign({},
                      configuration,
                      defaultConfiguration,
                      getUserMediaConfiguration());
    var rtcConfig = Object.assign({}, config, {
                      protocol: getSocketLocationFromProtocol().protocol,
                      port: getSocketLocationFromProtocol().port,
                      host: configuration.host,
                      streamName: configuration.stream1,
                      streamMode: recordingField.checked ? 'record' : 'live',
                      connectionParams: getConnectionParamsFromFormFields()
                   });
    var rtmpConfig = Object.assign({}, config, {
                      host: configuration.host,
                      app: configuration.app,
                      protocol: 'rtmp',
                      port: serverSettings.rtmpport,
                      streamName: configuration.stream1,
                      streamMode: recordingField.selected ? 'record' : 'live',
                      connectionParams: getConnectionParamsFromFormFields(),
                      backgroundColor: '#000000',
                      swf: '../../lib/red5pro/red5pro-publisher.swf',
                      swfobjectURL: '../../lib/swfobject/swfobject.js',
                      productInstallURL: '../../lib/swfobject/playerProductInstall.swf'
                  }, getRTMPMediaConfiguration());

    var publishOrder = config.publisherFailoverOrder
                            .split(',')
                            .map(function (item) {
                              return item.trim()
                        });

    if(window.query('view')) {
      publishOrder = [window.query('view')];
    }

    // call the `autoscale` method now
    //  declared on publisher and subscriber refs.
    return new red5prosdk.Red5ProPublisher()
          .setPublishOrder(publishOrder)
          .autoscale(autoscaleConfig, {
            rtc: rtcConfig,
            rtmp: rtmpConfig
          });
  }

  function showAddress (publisher) {
    var config = publisher.getOptions();
    console.log("Host = " + config.host + " | " + "app = " + config.app);
    if (publisher.getType().toLowerCase() === 'rtc') {
      displayServerAddress(config.connectionParams.host, config.host);
      console.log("Using streammanager proxy for rtc");
      console.log("Proxy target = " + config.connectionParams.host + " | " + "Proxy app = " + config.connectionParams.app)
      if(isSecure) {
        console.log("Operating over secure connection | protocol: " + config.protocol + " | port: " +  config.port);
      }
      else {
        console.log("Operating over unsecure connection | protocol: " + config.protocol + " | port: " +  config.port);
      }
    }
    else {
      displayServerAddress(config.host);
    }
  }

  function unpublish () {
    return new Promise(function (resolve, reject) {
      var publisher = targetPublisher;
      if (publisher) {
        var config = publisher.getOptions();
        var url =  'http://' + config.host + ':5080/auctionfrontier/publishstop';
        publisher.unpublish()
          .then(function () {
            onUnpublishSuccess();
            stopButton.setAttribute('disabled', true);
            submitButton.removeAttribute('disabled');
            resolve();
            notifyWebAppOfUnpublish(url);
          })
          .catch(function (error) {
            var jsonError = typeof error === 'string' ? error : JSON.stringify(error, 2, null);
            onUnpublishFail('Unmount Error ' + jsonError);
            reject(error);
            notifyWebAppOfUnpublish(url);
          });
      } else {
        stopButton.setAttribute('disabled', true);
        submitButton.removeAttribute('disabled');
        notifyWebAppOfUnpublish(url);
        resolve();
      }
    });
  }

  function startPublishing () {

    determinePublisher()
      .then(function (publisherImpl) {
        streamTitle.innerText = configuration.stream1;
        targetPublisher = publisherImpl;
        targetPublisher.on('*', onPublisherEvent);
        showAddress(targetPublisher);
        return targetPublisher.publish();
      })
      .then(function () {
        onPublishSuccess(targetPublisher);
        stopButton.removeAttribute('disabled');
      })
      .catch(function (error) {
        var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
        console.error('[Red5ProPublisher] :: Error in access of Origin IP: ' + jsonError);
        updateStatusFromEvent({
          type: red5prosdk.PublisherEventTypes.CONNECT_FAILURE
        });
        onPublishFail(jsonError);
        submitButton.removeAttribute('disabled');
      });

  }

  function startSession () {

    var ws = new WebSocket(websocketField.value)
    ws.onopen = function () {
      startPublishing();
    }
    ws.onmessage = function (event) {
      console.log('[WEBHOOK]>>');
      console.log(JSON.stringify(JSON.parse(event.data, null, 2)));
      console.log('<<[WEBHOOK]');
    }
    ws.onerror = function (event) {
      console.error('Could not open websocket for webhook communication!');
      console.error(event);
      // Start publishing anyway?
      startPublishing();
    }
    submitButton.setAttribute('disabled', true);

  }

  submitButton.addEventListener('click', startSession);
  stopButton.addEventListener('click', unpublish)

  window.addEventListener('beforeunload', function() {
    function clearRefs () {
      if (targetPublisher) {
        targetPublisher.off('*', onPublisherEvent);
      }
      targetPublisher = undefined;
    }
    unpublish().then(clearRefs).catch(clearRefs);
    window.untrackBitrate();
  });
})(this, document, window.red5prosdk, window.red5prosdk_ext_stream_manager);
