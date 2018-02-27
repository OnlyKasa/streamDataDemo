"use strict";
var RTCPeerConnection = null;
var room = null;
var initiator;
var pc = null;
var data_channel = null;
var channelReady;
var webSocket;
var chunkSize = 1024;
var receiverBuffer = null;
var recvMediaSource = null;
var remoteVideo = null;
var queue = [];

var pc_config = {"iceServers": [{url: 'stun:23.21.150.121'}, {url: 'stun:stun.l.google.com:19302'}]};

/**
 * init rtc channel
 * @param sURL
 * @param remotevideo
 */
function myrtclibinit(sURL, remotevideo) {
    remoteVideo = remotevideo;

    registrationChannel(sURL);
};

/**
 *  Registration channel for streaming data.
 * @param sURL : url of signaling server (localhost:8080)
 */
function registrationChannel(sURL) {
    // Status of channel
    channelReady = false;
    webSocket = new WebSocket(sURL);

    /// Event handler  of webSocket
    webSocket.onopen = onChannelOpened;
    webSocket.onmessage = onChannelMessage;
    webSocket.onclose = onChannelClosed;
};


function onChannelOpened() {

    channelReady = true;

    createPeerConnection();
    // location.search  =  "?room=100"   in case   http://localhost:8080/index.html?room=100
    if (location.search.substring(1, 5) == "room") {
        room = location.search.substring(6);
        sendMessage({"type": "ENTERROOM", "value": room * 1});
        initiator = true;

        // Create offer
        doCall();
    } else {
        sendMessage({"type": "GETROOM", "value": ""});
        initiator = false;
    }
};

function onChannelMessage(message) {
    processSignalingMessage(message.data);
};

function onChannelClosed() {
    channelReady = false;
};

function sendMessage(message) {
    var msgString = JSON.stringify(message);
    channel.send(msgString);
};

function processSignalingMessage(message) {
    var msg = JSON.parse(message);
    if (msg.type === 'offer') {
        pc.setRemoteDescription(new RTCSessionDescription(msg));
        doAnswer();
    } else if (msg.type === 'answer') {
        pc.setRemoteDescription(new RTCSessionDescription(msg));
    } else if (msg.type === 'candidate') {
        var candidate = new RTCIceCandidate({sdpMLineIndex: msg.label, candidate: msg.candidate});
        pc.addIceCandidate(candidate);
    } else if (msg.type === 'GETROOM') {
        room = msg.value;
        onRoomReceived(room);
    } else if (msg.type === 'WRONGROOM') {
        window.location.href = "/";
    }
};

// Create Connection peer to peer
function createPeerConnection() {
    try {
        pc = new RTCPeerConnection(pc_config);
        pc.onicecandidate = function onIceCandidate(event) {
            console.log(event.candidate);
            if (event.candidate)
                sendMessage({
                    type: 'candidate', label:
                    event.candidate.sdpMLineIndex, id: event.candidate.sdpMid, candidate:
                    event.candidate.candidate
                });
        };
        pc.ondatachannel = function onDataChannel(evt) {
            console.log('Received data channel creating request');
            data_channel = evt.channel;
            initDataChannel();

        };
        console.log(pc);
    } catch (e) {
        console.log(e);
        pc = null;
    }
};


function initDataChannel() {
    data_channel.onopen = onChannelStateChange;
    data_channel.onclose = onChannelStateChange;
    data_channel.onmessage = onReceiveMessageCallback;
}

function onIceCandidate(event) {
    if (event.candidate)
        sendMessage({
            type: 'candidate', label:
            event.candidate.sdpMLineIndex, id: event.candidate.sdpMid, candidate:
            event.candidate.candidate
        });
};

function failureCallback(e) {
    console.log("failure callback " + e.message);
}

function doCall() {
    createDataChannel("caller");
    pc.createOffer(setLocalAndSendMessage, failureCallback, null);
};


function createDataChannel(role) {
    try {
        data_channel = pc.createDataChannel("datachannel_" + room + role, null);
    } catch (e) {
        console.log('error creating data channel ' + e);
        return;
    }
    initDataChannel();
}

function doAnswer() {
    pc.createAnswer(setLocalAndSendMessage, failureCallback, null);
};

function setLocalAndSendMessage(sessionDescription) {
    pc.setLocalDescription(sessionDescription);
    sendMessage(sessionDescription);
};

function sendDataMessage(data) {
    data_channel.send(data);
};

function onChannelStateChange() {
    console.log('Data channel state is: ' + data_channel.readyState);
}

window.MediaSource = window.MediaSource || window.WebKitMediaSource;

function setLocalAndSendMessage(sessionDescription) {
    sessionDescription.sdp = setBandwidth(sessionDescription.sdp);
    pc.setLocalDescription(sessionDescription, function () {},failureCallback);
    sendMessage(sessionDescription);

};

function onReceiveMessageCallback(event) {
    try {
        var msg = JSON.parse(event.data);
        if (msg.type == 'chunk') {
            onChunk(msg.data);
        }
    } catch (e) {
    }
};

function setBandwidth(sdp) {
    sdp = sdp.replace(/a=mid:data\r\n/g, 'a=mid:data\r\nb=AS:1638400\r\n');
    return sdp;
}


var streamBlob = null;
var streamIndex = 0;
var streamSize = 0;

/**
 * Start stream media with streaming file
 * @param fileName
 */
function doStreamMedia(fileName) {
    var fileReader = new window.FileReader();
    fileReader.onload = function (e) {
        console.log(e.target.result);
        streamBlob = new window.Blob([new
        window.Uint8Array(e.target.result)]);
        streamSize = streamBlob.size;
        streamIndex = 0;
        streamChunk();
    };
    fileReader.readAsArrayBuffer(fileName);
}

function streamChunk() {
    if (streamIndex >= streamSize) sendDataMessage({end: true});
    var fileReader = new window.FileReader();
    fileReader.onload = function (e) {
        var chunk = new window.Uint8Array(e.target.result);
        streamIndex += chunkSize;
        pushChunk(chunk);
        window.requestAnimationFrame(streamChunk);
    };
    fileReader.readAsArrayBuffer(streamBlob.slice(streamIndex, streamIndex + chunkSize));
}

function pushChunk(data) {
    var msg = JSON.stringify({"type": "chunk", "data": Array.apply(null, data)});
    sendDataMessage(msg);
};

function doReceiveStreaming() {
    recvMediaSource = new MediaSource();
    remoteVideo.src = window.URL.createObjectURL(recvMediaSource);
    recvMediaSource.addEventListener('sourceopen', function (e) {
        remoteVideo.play();
        receiverBuffer = recvMediaSource.addSourceBuffer('video/webm; codecs="vorbis,vp8"');
        receiverBuffer.addEventListener('error', function (e) {
            console.log('error: ' + receiverBuffer.readyState);
        });
        receiverBuffer.addEventListener('abort', function (e) {
            console.log('abort: ' + receiverBuffer.readyState);
        });
        receiverBuffer.addEventListener('update', function (e) {
            if (queue.length > 0 && !receiverBuffer.updating)
                doAppendStreamingData(queue.shift());
        });
        console.log('media source state: ', this.readyState);
        doAppendStreamingData(queue.shift());
    }, false);
    recvMediaSource.addEventListener('sourceended', function (e) {
        console.log('sourceended: ' + this.readyState);
    });
    recvMediaSource.addEventListener('sourceclose', function (e) {
        console.log('sourceclose: ' + this.readyState);
    });
    recvMediaSource.addEventListener('error', function (e) {
        console.log('error: ' + this.readyState);
    });
};

function doAppendStreamingData(data) {
    var uint8array = new window.Uint8Array(data);
    receiverBuffer.appendBuffer(uint8array);
};

function doEndStreamingData() {
    recvMediaSource.endOfStream();
};


var chunks = 0;

function onChunk(data) {
    chunks++;
    if (chunks == 1) {
        console.log("first frame");
        queue.push(data);
        doReceiveStreaming();
        return;
    }
    if (data.end) {
        console.log("last frame");
        doEndStreamingData();
        return;
    }
    if (receiverBuffer.updating || queue.length > 0)
        queue.push(data);
    else doAppendStreamingData(data);
};




