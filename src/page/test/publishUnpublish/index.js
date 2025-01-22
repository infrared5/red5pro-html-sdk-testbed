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
;(function (window, document, red5prosdk) {
  'use strict'

  var serverSettings = (function () {
    var settings = sessionStorage.getItem('r5proServerSettings')
    try {
      return JSON.parse(settings)
    } catch (e) {
      console.error(
        'Could not read server settings from sessionstorage: ' + e.message
      )
    }
    return {}
  })()

  var configuration = (function () {
    var conf = sessionStorage.getItem('r5proTestBed')
    try {
      return JSON.parse(conf)
    } catch (e) {
      console.error(
        'Could not read testbed configuration from sessionstorage: ' + e.message
      )
    }
    return {}
  })()

  red5prosdk.setLogLevel(
    configuration.verboseLogging
      ? red5prosdk.LOG_LEVELS.TRACE
      : red5prosdk.LOG_LEVELS.WARN
  )

  var targetPublisher

  var previewControl = document.getElementById('remove-preview-control')
  var previewCheck = document.getElementById('remove-preview-check')
  var pubUnpubButton = document.getElementById('publish-unpublish-btn')

  var currentState = ''
  var STATE_PUBLISHING = 'publishingState'
  var STATE_UNPUBLISHED = 'unpublishedState'
  function enablePreview(toEnable) {
    previewCheck.setAttribute('disabled', toEnable)
    pubUnpubButton.setAttribute('disabled', toEnable)
    pubUnpubButton.disabled = previewCheck.disabled = false
  }
  function setUIState(state) {
    currentState = state
    if (state === STATE_PUBLISHING) {
      enablePreview(true)
      previewControl.classList.remove('hidden')
      pubUnpubButton.innerText = 'Unpublish'
    } else if (state === STATE_UNPUBLISHED) {
      previewControl.classList.add('hidden')
      pubUnpubButton.innerText = 'Publish'
      pubUnpubButton.setAttribute('disabled', false)
      pubUnpubButton.disabled = false
    }
  }
  pubUnpubButton.addEventListener('click', function () {
    var removePreview = previewCheck.checked
    if (currentState === STATE_PUBLISHING) {
      unpublish(removePreview)
    } else {
      beginPublish(removePreview)
    }
  })

  var updateStatusFromEvent = window.red5proHandlePublisherEvent // defined in src/template/partial/status-field-publisher.hbs
  var streamTitle = document.getElementById('stream-title')
  var statisticsField = document.getElementById('statistics-field')

  var protocol = serverSettings.protocol
  function getSocketLocationFromProtocol() {
    return window.getSocketProtocolPort(
      protocol,
      serverSettings,
      configuration.usePortMux
    )
  }

  function onBitrateUpdate(bitrate, packetsSent) {
    statisticsField.innerText =
      'Bitrate: ' + Math.floor(bitrate) + '. Packets Sent: ' + packetsSent + '.'
  }

  function onPublisherEvent(event) {
    console.log('[Red5ProPublisher] ' + event.type + '.')
    updateStatusFromEvent(event)
  }
  function onPublishFail(message) {
    console.error('[Red5ProPublisher] Publish Error :: ' + message)
  }
  function onPublishSuccess(publisher) {
    console.log('[Red5ProPublisher] Publish Complete.')
    setUIState(STATE_PUBLISHING)
    try {
      window.trackBitrate(publisher.getPeerConnection(), onBitrateUpdate)
    } catch (e) {
      // no tracking for you!
    }
  }
  function onUnpublishFail(message) {
    console.error('[Red5ProPublisher] Unpublish Error :: ' + message)
    targetPublisher = undefined
    setUIState(STATE_UNPUBLISHED)
  }
  function onUnpublishSuccess() {
    console.log('[Red5ProPublisher] Unpublish Complete.')
    targetPublisher = undefined
    setUIState(STATE_UNPUBLISHED)
  }

  function getAuthenticationParams() {
    var auth = configuration.authentication
    return auth && auth.enabled
      ? {
          connectionParams: {
            username: auth.username,
            password: auth.password,
            token: auth.token,
          },
        }
      : {}
  }

  function getUserMediaConfiguration() {
    return {
      mediaConstraints: {
        audio: configuration.useAudio
          ? configuration.mediaConstraints.audio
          : false,
        video: configuration.useVideo
          ? configuration.mediaConstraints.video
          : false,
      },
    }
  }

  function unpublish(removePreview) {
    return new Promise(function (resolve, reject) {
      var publisher = targetPublisher
      publisher._options.clearMediaOnUnpublish = removePreview
      publisher
        .unpublish(removePreview)
        .then(function () {
          onUnpublishSuccess()
          resolve()
        })
        .catch(function (error) {
          var jsonError =
            typeof error === 'string' ? error : JSON.stringify(error, 2, null)
          onUnpublishFail('Unmount Error ' + jsonError)
          reject(error)
        })
    })
  }

  const { preferWhipWhep } = configuration
  const { WHIPClient, RTCPublisher } = red5prosdk

  var rtcConfig = Object.assign(
    {},
    configuration,
    getAuthenticationParams(),
    getUserMediaConfiguration(),
    {
      protocol: getSocketLocationFromProtocol().protocol,
      port: getSocketLocationFromProtocol().port,
      streamName: configuration.stream1,
      streamMode: configuration.recordBroadcast ? 'record' : 'live',
      clearMediaOnUnpublish: true,
    }
  )

  function beginPublish() {
    var publisher = preferWhipWhep ? new WHIPClient() : new RTCPublisher()
    publisher
      .init(rtcConfig)
      .then(function (publisherImpl) {
        streamTitle.innerText = configuration.stream1
        targetPublisher = publisherImpl
        targetPublisher.on('*', onPublisherEvent)
        return targetPublisher.publish()
      })
      .then(function () {
        onPublishSuccess(targetPublisher)
      })
      .catch(function (error) {
        var jsonError =
          typeof error === 'string' ? error : JSON.stringify(error, null, 2)
        console.error(
          '[Red5ProPublisher] :: Error in publishing - ' + jsonError
        )
        onPublishFail(jsonError)
      })
  }

  var shuttingDown = false
  function shutdown() {
    if (shuttingDown) return
    shuttingDown = true
    function clearRefs() {
      if (targetPublisher) {
        targetPublisher.off('*', onPublisherEvent)
      }
      targetPublisher = undefined
    }
    var removePreview = previewCheck.checked
    unpublish(removePreview).then(clearRefs).catch(clearRefs)
    window.untrackBitrate()
  }
  window.addEventListener('pagehide', shutdown)
  window.addEventListener('beforeunload', shutdown)

  beginPublish()
})(this, document, window.red5prosdk)
