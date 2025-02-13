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
An  example  of  the EULA can be found on our website at: https://account.red5.net/assets/LICENSE.txt.

The above copyright notice and this license shall be included in all copies or portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,  INCLUDING  BUT
NOT  LIMITED  TO  THE  WARRANTIES  OF  MERCHANTABILITY, FITNESS  FOR  A  PARTICULAR  PURPOSE  AND
NONINFRINGEMENT.   IN  NO  EVENT  SHALL INFRARED5, INC. BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN  AN  ACTION  OF  CONTRACT,  TORT  OR  OTHERWISE,  ARISING  FROM,  OUT  OF  OR  IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Defining/accessing testbed configuration.
;(function (window, adapter) {
  if (typeof adapter !== 'undefined') {
    console.log('Browser: ' + JSON.stringify(adapter.browserDetails, null, 2))
  }

  // http://stackoverflow.com/questions/901115/how-can-i-get-query-string-values-in-javascript
  function getParameterByName(name, url) {
    // eslint-disable-line no-unused-vars
    if (!url) {
      url = window.location.href
    }
    name = name.replace(/[\[\]]/g, '\\$&')
    var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
      results = regex.exec(url)
    if (!results) return null
    if (!results[2]) return ''
    return decodeURIComponent(results[2].replace(/\+/g, ' '))
  }

  var build_version = '$VERSION'
  var protocol = window.location.protocol
  var port = window.location.port
  protocol = protocol.substring(0, protocol.lastIndexOf(':'))

  var isMoz = !!navigator.mozGetUserMedia
  var isEdge = window.navigator.userAgent.indexOf('Edge') > -1
  var isiPod = !!navigator.platform && /iPod/.test(navigator.platform)
  var config = sessionStorage.getItem('r5proTestBed')
  var json
  var serverSettings = {
    protocol: protocol,
    httpport: port,
    hlsport: 5080,
    hlssport: 443,
    wsport: 5080,
    wssport: 443,
    rtmpport: 1935,
    rtmpsport: 1936,
  }
  function assignStorage() {
    json = {
      version: build_version,
      host: window.location.hostname,
      port: 5080,
      stream1: 'stream1',
      stream2: 'stream2',
      app: 'live',
      proxy: 'streammanager',
      streamMode: 'live',
      cameraWidth: 640,
      cameraHeight: 480,
      embedWidth: '100%',
      embedHeight: 480,
      buffer: 0,
      bandwidth: {
        audio: 56,
        video: 750,
      },
      signalingSocketOnly: true,
      enableChannelSignaling: true, // WHIP/WHEP specific
      disableProxy: true, // WHIP/WHEP specific
      trickleIce: true, // Flag to use trickle ice to send candidates
      keyFramerate: 3000,
      useAudio: true,
      useVideo: true,
      sendLogLevel: 'DEBUG',
      mediaConstraints: {
        audio: isiPod ? false : true,
        video:
          isMoz || isEdge
            ? true
            : {
                width: {
                  min: 320,
                  max: 640,
                },
                height: {
                  min: 240,
                  max: 480,
                },
                frameRate: {
                  min: 8,
                  max: 30,
                },
              },
      },
      publisherFailoverOrder: 'rtc,rtmp',
      subscriberFailoverOrder: 'rtc,rtmp,hls',
      rtcConfiguration: {
        iceServers: [
          {
            urls: 'stun:stun2.l.google.com:19302',
          },
        ],
        bundlePolicy: 'max-bundle',
        iceCandidatePoolSize: 2,
        iceTransportPolicy: 'all',
        rtcpMuxPolicy: 'require',
      },
      googleIce: [
        {
          urls: 'stun:stun2.l.google.com:19302',
        },
      ],
      mozIce: [
        {
          urls: 'stun:stun.services.mozilla.com:3478',
        },
      ],
      iceTransport: 'udp',
      verboseLogging: true,
      recordBroadcast: false,
      streamManagerAPI: 'v1',
      streamManagerUser: undefined,
      streamManagerPassword: undefined,
      streamManagerAccessToken: 'xyz123',
      streamManagerRegion: undefined,
      streamManagerNodeGroup: 'default',
      muteOnAutoplayRestriction: true,
      authentication: {
        enabled: false,
        username: 'user',
        password: 'pass',
        token: 'token',
      },
      mixerBackendSocketField: '',
      mixerAuthenticationEnabled: false,
      preferWhipWhep: true,
      offerSDPResolution: false,
    }

    /**
    if (isMoz) {
      json.rtcConfiguration.iceServers = json.mozIce;
    }
    */
    sessionStorage.setItem('r5proTestBed', JSON.stringify(json))
  }

  function defineIceServers() {
    var param = getParameterByName('ice')
    if (param) {
      if (param === 'moz') {
        json.rtcConfiguration.iceServers = json.mozIce
      } else {
        json.rtcConfiguration.iceServers = json.googleIce
      }
      console.log(
        'ICE server provided in query param: ' +
          JSON.stringify(json.rtcConfiguration.iceServers, null, 2)
      )
    }
  }

  if (config) {
    try {
      json = JSON.parse(config)
      if (json.version && json.version !== build_version) {
        console.log(
          'We have replaced your stale session version: ' +
            json.version +
            ' with ' +
            build_version +
            '. Have fun streaming!'
        )
        sessionStorage.removeItem('r5proTestBed')
        assignStorage()
      } else if (!json.version) {
        console.log(
          'We recently added session swaps with the latest version: ' +
            build_version +
            '. Have fun streaming!'
        )
        sessionStorage.removeItem('r5proTestBed')
        assignStorage()
      }
    } catch (e) {
      assignStorage()
    } finally {
      defineIceServers()
      sessionStorage.setItem('r5proTestBed', JSON.stringify(json))
    }
  } else {
    assignStorage()
    defineIceServers()
    sessionStorage.setItem('r5proTestBed', JSON.stringify(json))
  }

  sessionStorage.setItem('r5proServerSettings', JSON.stringify(serverSettings))
  return json
})(this, window.adapter)
