/*
Copyright © 2015 Infrared5, Inc. All rights reserved.

The accompanying code comprising examples for use solely in conjunction with Red5 Pro (the "Example Code") 
is  licensed  to  you  by  Infrared5  Inc.  in  consideration  of  your  agreement  to  the  following  
license terms  and  conditions.  Access,  use,  modification,  or  redistribution  of  the  accompanying  
code  constitutes your acceptance of the following license terms and conditions.

Permission is hereby granted, free of charge, to you to use the Example Code and associated documentation 
files (collectively, the "Software") without restriction, including without limitation the rights to use, 
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit 
persons to whom the Software is furnished to do so, subject to the following conditions:

The Software shall be used solely in conjunction with Red5 Pro. Red5 Pro is licensed under a separate end 
user  license  agreement  (the  "EULA"),  which  must  be  executed  with  Infrared5,  Inc.   
An  example  of  the EULA can be found on our website at: https://account.red5pro.com/assets/LICENSE.txt.

The above copyright notice and this license shall be included in all copies or portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,  INCLUDING  BUT  
NOT  LIMITED  TO  THE  WARRANTIES  OF  MERCHANTABILITY, FITNESS  FOR  A  PARTICULAR  PURPOSE  AND  
NONINFRINGEMENT.   IN  NO  EVENT  SHALL INFRARED5, INC. BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, 
WHETHER IN  AN  ACTION  OF  CONTRACT,  TORT  OR  OTHERWISE,  ARISING  FROM,  OUT  OF  OR  IN CONNECTION 
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
(function(window, document, red5prosdk, Hls) {
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

  var updateStatusFromEvent = window.red5proHandleSubscriberEvent; // defined in src/template/partial/status-field-subscriber.hbs
  var streamTitle = document.getElementById('stream-title');

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

  var hlsConfig = Object.assign({}, configuration, defaultConfiguration, {
    protocol: protocol,
    port: isSecure ? serverSettings.hlssport : serverSettings.hlsport,
    streamName: configuration.stream1,
    mimeType: 'application/x-mpegURL'
  })

  var element = document.getElementById('red5pro-subscriber');
  var portUri = hlsConfig.protocol === 'https' ? '' : ':' + hlsConfig.port;
  var url = hlsConfig.protocol + '://' + hlsConfig.host + portUri + '/' + hlsConfig.app + '/' + hlsConfig.streamName + '.m3u8'
  streamTitle.innerText = hlsConfig.stream1;
  if (Hls.isSupported()) {
    var hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(element);
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      updateStatusFromEvent({type: window.red5prosdk.SubscriberEventTypes.SUBSCRIBE_START});
      element.play();
    });
    hls.on(Hls.Events.ERROR, function (err, info) {
      console.error('[Red5ProSubscriber] :: ERROR in playback using hls.js');
      console.error(err);
      console.log('[Red5ProSubscriber] :: ERROR INFO >');
      console.log(info);
      updateStatusFromEvent({type: window.red5prosdk.SubscriberEventTypes.SUBSCRIBE_FAIL});
    });
  } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
    element.src = url;
    element.addEventListener('loadedmetadata', function () {
      updateStatusFromEvent({type: window.red5prosdk.SubscriberEventTypes.SUBSCRIBE_START});
      element.play();
    });
  } else {
    console.error('[Red5ProSubscriber] Could not establish failover of shim.');
    updateStatusFromEvent({type: window.red5prosdk.SubscriberEventTypes.SUBSCRIBE_FAIL});
  }

})(this, document, window.red5prosdk, window.Hls);

