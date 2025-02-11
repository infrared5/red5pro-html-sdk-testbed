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
;(function (window, document, red5prosdk, streamManagerUtil) {
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

	var updateStatusFromEvent = window.red5proHandlePublisherEvent // defined in src/template/partial/status-field-publisher.hbs
	var streamTitle = document.getElementById('stream-title')
	var statisticsField = document.getElementById('statistics-field')
	var addressField = document.getElementById('address-field')
	var bitrateField = document.getElementById('bitrate-field')
	var packetsField = document.getElementById('packets-field')
	var resolutionField = document.getElementById('resolution-field')

	var protocol = serverSettings.protocol
	var isSecure = protocol == 'https'
	function getSocketLocationFromProtocol() {
		return !isSecure
			? { protocol: 'ws', port: serverSettings.wsport }
			: { protocol: 'wss', port: serverSettings.wssport }
	}

	streamTitle.innerText = configuration.stream1
	var defaultConfiguration = {
		protocol: getSocketLocationFromProtocol().protocol,
		port: getSocketLocationFromProtocol().port,
		streamMode: configuration.recordBroadcast ? 'record' : 'live',
	}

	streamTitle.innerText = configuration.stream1

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

	const displayServerAddress = (serverAddress, proxyAddress) => {
		addressField.classList.remove('hidden')
		proxyAddress = typeof proxyAddress === 'undefined' ? 'N/A' : proxyAddress
		addressField.innerText = `Proxy Address: ${proxyAddress} | Origin Address: ${serverAddress}`
	}

	var bitrate = 0
	var packetsSent = 0
	var frameWidth = 0
	var frameHeight = 0

	// XXX socialpusher
	var sendButton = document.getElementById('send-button')
	var destUri = document.getElementById('dest-URI')
	var streamKey = document.getElementById('stream-key')
	var proxyUser = document.getElementById('user')
	var proxyPasswd = document.getElementById('passwd')
	var isForwarding = false

	let attempts = 0
	let attemptLimit = 10

	// from https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
	async function digestMessage(message) {
		const msgUint8 = new TextEncoder().encode(message) // encode as (utf-8) Uint8Array
		const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8) // hash the message
		const hashArray = Array.from(new Uint8Array(hashBuffer)) // convert buffer to byte array
		const hashHex = hashArray
			.map((b) => {
				var result = b.toString(16).padStart(2, '0')
				//console.log("b: " + b + " result: " + result);
				return result
			})
			.join('') // convert bytes to hex string
		return hashHex
	}

	function createSignature(timestamp) {
		var action = isForwarding ? 'provision.delete' : 'provision.create'
		var message = action + timestamp + proxyPasswd.value

		return digestMessage(message)
	}

	async function pushItSocial() {
		console.log('Begin pushItSocial()')
		sendButton.disabled = true

		const {
			host,
			app,
			stream1,
			streamManagerAPI: version,
			streamManagerNodeGroup: nodeGroup,
		} = configuration
		const data = JSON.stringify({
			provisions: [
				{
					guid: 'any',
					level: 1,
					context: app,
					name: stream1,
					parameters: {
						destURI: destUri.value + '/' + streamKey.value,
					},
				},
			],
		})
		const origin = await streamManagerUtil.getOriginForStream(host, version, nodeGroup, app + "/" + stream1)
		let url = `http://${origin}:5080/socialpusher/api?action=provision.${
			isForwarding ? 'delete' : 'create'
		}`
		var timestamp = Date.now()
		url += '&timestamp=' + timestamp
		var signature = await createSignature(timestamp)
		url += '&signature=' + signature

		const result = await streamManagerUtil.forwardPostWithResult(
			host,
			version,
			url,
			data
		)
		if (result.status >= 200 && result.status < 300) {
			isForwarding = !isForwarding
			sendButton.disabled = false
			sendButton.innerHTML = isForwarding
				? 'Stop Forwarding'
				: 'Begin Forwarding'
			console.log('isForwarding: ' + isForwarding)
		} else if (result.status == 504) {
			// The server response 504 when the stream forwarding attempt fails due to timeout.
			// Other failures should not be retried.
			if (++attempts < attemptLimit) {
				console.log('Social media connection timed out. Retrying...')
				var t = setTimeout(() => {
					clearTimeout(t)
					pushItSocial()
				}, 10000) // 10000: 10s; The server may take up to 7 seconds (plus client-to-server roundtrip latency) to respond.
			}
		} else {
			sendButton.disabled = false
			console.log('error status: ' + this.status)
		}
		console.log('POST to uri: ' + url)
		console.log('Send data: ' + data)
	}


	async function newPushIt() {
		sendButton.disabled = true

		// gather info
		let smApi = "v1"
		const {
			host,
			app,
			stream1,
			smApi: version,
			streamManagerNodeGroup: nodeGroup,
		} = configuration
		const data = JSON.stringify({
			provisions: [
				{
					guid: 'any',
					level: 1,
					context: app,
					name: stream1,
					parameters: {
						destURI: destUri.value + '/' + streamKey.value,
					},
				},
			],
		})

		// first login for proxy JWT
		let jwt;
		try {
			jwt = await streamManagerUtil.authenticate2(host, smApi, proxyUser.value, proxyPasswd.value)
		} catch (e) {
			console.error('Error authenticating with Stream Manager (failed to log in with Proxy User)', e)
			alert(
				`Error authenticating with Stream Manager  (failed to log in with Proxy User): ${
					e.message ? e.message : 'error'
				}. See console for details.`
			)
			throw e;
		}

		// get the origin for the stream
		const origin = await streamManagerUtil.getOriginForStream(host, smApi, nodeGroup, app + "/" + stream1)

		let digestAction = `provision.${isForwarding ? 'delete' : 'create'}`
		let originUrl = `http://${origin}:5080/socialpusher/api`

		let url = `https://${host}/as/${smApi}/proxy/forward/?nodegroup=${nodeGroup}&digestAction=${digestAction}&target=${encodeURIComponent(
			originUrl
		)}`

		console.log('POST to uri: ' + url)
		console.log('Send data: ' + data)

		/* old async
		const result = await fetch(url, {
			method: 'POST',
			withCredentials: true,
			credentials: 'include',
			headers: {
				Authorization: `Bearer ${jwt}`,
				'Content-Type': 'application/json',
			},
			body: typeof data === 'string' ? data : JSON.stringify(data),
		})
		
		if (result.status >= 200 && result.status < 300) {
			try {
				const json = await result.json()
				if (json && json.errorMessage) {
					throw new Error(json.errorMessage)
				} else {
					return json
				}
			} catch (e) {
				console.error('Provision response JSON parse failed: ' + e.message)
			}
			return { success: true }
		} else if (result.status == 504) {
			// The server response 504 when the stream forwarding attempt fails due to timeout.
			// Other failures should not be retried.
			if (++attempts < attemptLimit) {
				console.log('Social media connection timed out. Retrying...')
				var t = setTimeout(() => {
					clearTimeout(t)
					newPushIt()
				}, 10000) // 10000: 10s; The server may take up to 7 seconds (plus client-to-server roundtrip latency) to respond.
			} else {
				alert("Social media connection timed out (after " + attempts + " attempts). Please try again.")
			}
		} else {
			sendButton.disabled = false
			console.log('Error: Failed to POST Social Pusher provision: ' + result.status)
			alert("Error: Failed to POST Social Pusher provision" + result.status + " " + result.statusText);
		}
		*/

		// new synchronous
		while (attempts < attemptLimit) {
			const xhr = new XMLHttpRequest();
			try {
				// Open the synchronous request
				xhr.open('POST', url, false); // false makes it synchronous
				xhr.withCredentials = true; // Send credentials (cookies)
				xhr.setRequestHeader('Authorization', `Bearer ${jwt}`);
				xhr.setRequestHeader('Content-Type', 'application/json');
	
				// Send the request body
				xhr.send(typeof data === 'string' ? data : JSON.stringify(data));
	
				let responseBody = xhr.responseText;
	
				// Always try to parse JSON, regardless of Content-Type
				try {
					responseBody = JSON.parse(responseBody);
				} catch (parseError) {
					console.warn('Response is not valid JSON:', parseError);
					// Leave responseBody as text if parsing fails
				}
	
				// Handle successful response (status 2xx)
				if (xhr.status >= 200 && xhr.status < 300) {
					isForwarding = !isForwarding
					sendButton.disabled = false
					sendButton.innerHTML = isForwarding
						? 'Stop Forwarding'
						: 'Begin Forwarding'
					console.log('isForwarding: ' + isForwarding)

					return;
				} else if (xhr.status === 504) { // Handle 504 Gateway Timeout (this signals that Red5Pro server timed out while trying to forward the stream to the social media platform)
					attempts++;
					console.log(`Social media connection timed out. Retrying attempt ${attempts}/${attemptLimit}...`);
					if (attempts < attemptLimit) {
						sleep(10 * 1000); // Wait for 10 seconds before retrying
						continue; // Retry the request
					} else {
						// throw timeout exception
						throw new Error(`Social media connection timed out after ${attempts} attempts. Please try again.`);
					}
				} else {
					// Handle other HTTP errors (do not retry non-timeout failures)
					throw new Error(`HTTP ${xhr.status}: ${xhr.statusText}`);
				}
			} catch (error) {
				sendButton.disabled = false
				let responseBody = xhr.responseText;
				console.error(`Error in synchronousPost attempt ${attempts + 1}:`, error, responseBody);
				if (xhr.status !== 504) {
					// For non-504 errors, stop retrying 
					alert(`Error: Failed to POST Social Pusher provision. ${error.message} -- ${responseBody}`);
					throw error;
				} // else if it WAS 504, then maybe retry according to attemptLimit (implicitly handled by the loop)
			}
		}
	}

	sendButton.addEventListener('click', () => {
		attempts = 0
		newPushIt()
	})
	// XXX /socialpusher

	function updateStatistics(b, p, w, h) {
		statisticsField.classList.remove('hidden')
		bitrateField.innerText = b === 0 ? 'N/A' : Math.floor(b)
		packetsField.innerText = p
		resolutionField.innerText = (w || 0) + 'x' + (h || 0)
	}

	function onBitrateUpdate(b, p) {
		bitrate = b
		packetsSent = p
		updateStatistics(bitrate, packetsSent, frameWidth, frameHeight)
	}

	function onResolutionUpdate(w, h) {
		frameWidth = w
		frameHeight = h
		updateStatistics(bitrate, packetsSent, frameWidth, frameHeight)
	}

	function onPublisherEvent(event) {
		const { type } = event
		console.log('[Red5ProPublisher] ' + type + '.')
		updateStatusFromEvent(event)
		if (type === 'WebRTC.Endpoint.Changed') {
			const { host } = configuration
			const { data } = event
			const { endpoint } = data
			displayServerAddress(endpoint, host)
		}
	}
	function onPublishFail(message) {
		console.error('[Red5ProPublisher] Publish Error :: ' + message)
	}
	function onPublishSuccess(publisher) {
		console.log('[Red5ProPublisher] Publish Complete.')
		try {
			var pc = publisher.getPeerConnection()
			var stream = publisher.getMediaStream()
			window.trackBitrate(pc, onBitrateUpdate, onResolutionUpdate)
			statisticsField.classList.remove('hidden')
			stream.getVideoTracks().forEach(function (track) {
				var settings = track.getSettings()
				onResolutionUpdate(settings.width, settings.height)
			})
		} catch (e) {
			// no tracking for you!
		}
	}
	function onUnpublishFail(message) {
		console.error('[Red5ProPublisher] Unpublish Error :: ' + message)
	}
	function onUnpublishSuccess() {
		console.log('[Red5ProPublisher] Unpublish Complete.')
	}

	function getRegionIfDefined() {
		var region = configuration.streamManagerRegion
		if (
			typeof region === 'string' &&
			region.length > 0 &&
			region !== 'undefined'
		) {
			return region
		}
		return undefined
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

	const getConfiguration = () => {
		const {
			host,
			app,
			stream1,
			streamManagerAPI,
			preferWhipWhep,
			streamManagerNodeGroup: nodeGroup,
		} = configuration
		const { protocol, port } = getSocketLocationFromProtocol()

		const region = getRegionIfDefined()
		const params = region
			? {
					region,
					strict: true,
				}
			: undefined

		const httpProtocol = protocol === 'wss' ? 'https' : 'http'
		const endpoint = !preferWhipWhep
			? `${protocol}://${host}:${port}/as/${streamManagerAPI}/proxy/ws/publish/${app}/${stream1}`
			: `${httpProtocol}://${host}:${port}/as/${streamManagerAPI}/proxy/whip/${app}/${stream1}`

		const connectionParams = params
			? { ...params, ...getAuthenticationParams().connectionParams }
			: getAuthenticationParams().connectionParams

		const rtcConfig = {
			...configuration,
			...defaultConfiguration,
			...getUserMediaConfiguration(),
			endpoint,
			streamName: stream1,
			connectionParams: {
				...connectionParams,
				nodeGroup,
			},
		}

		return rtcConfig
	}

	const startPublish = async () => {
		try {
			const { RTCPublisher, WHIPClient } = red5prosdk
			const { preferWhipWhep, stream1 } = configuration
			const config = getConfiguration()
			const publisher = preferWhipWhep ? new WHIPClient() : new RTCPublisher()
			publisher.on('*', onPublisherEvent)
			await publisher.init(config)
			await publisher.publish()
			onPublishSuccess(publisher)
			streamTitle.innerText = stream1
			targetPublisher = publisher
		} catch (error) {
			var jsonError =
				typeof error === 'string' ? error : JSON.stringify(error, null, 2)
			console.error(
				'[Red5ProPublisher] :: Error in access of Origin IP: ' + jsonError
			)
			updateStatusFromEvent({
				type: red5prosdk.PublisherEventTypes.CONNECT_FAILURE,
			})
			onPublishFail(jsonError)
		}
	}

	const unpublish = async () => {
		try {
			const publisher = targetPublisher
			await publisher.unpublish()
			onUnpublishSuccess()
		} catch (error) {
			var jsonError =
				typeof error === 'string' ? error : JSON.stringify(error, 2, null)
			onUnpublishFail('Unmount Error ' + jsonError)
			throw error
		}
	}

	let shuttingDown = false
	const shutdown = async () => {
		if (shuttingDown) return
		shuttingDown = true
		try {
			await unpublish()
		} catch (e) {
			console.error(e)
		} finally {
			if (targetPublisher) {
				targetPublisher.off('*', onPublisherEvent)
			}
			targetPublisher = undefined
		}
		window.untrackBitrate()
	}
	window.addEventListener('pagehide', shutdown)
	window.addEventListener('beforeunload', shutdown)

	startPublish()
})(this, document, window.red5prosdk, window.streamManagerUtil)
