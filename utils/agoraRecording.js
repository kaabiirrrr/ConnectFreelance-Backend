const axios = require('axios');

const BASE_URL = `https://api.agora.io/v1/apps/${process.env.AGORA_APP_ID}/cloud_recording`;

// Basic auth header using Customer ID + Secret
const getAuthHeader = () => {
    const credentials = Buffer.from(
        `${process.env.AGORA_CUSTOMER_ID}:${process.env.AGORA_CUSTOMER_SECRET}`
    ).toString('base64');
    return { Authorization: `Basic ${credentials}` };
};

// STEP 1: Acquire a resource ID
async function acquireResource(channelName, uid = '999') {
    const { data } = await axios.post(
        `${BASE_URL}/acquire`,
        { cname: channelName, uid, clientRequest: {} },
        { headers: getAuthHeader() }
    );
    return data.resourceId;
}

// STEP 2: Start cloud recording
async function startRecording(resourceId, channelName, token, uid = '999', storageConfig) {
    const { data } = await axios.post(
        `${BASE_URL}/resourceid/${resourceId}/mode/mix/start`,
        {
            cname: channelName,
            uid,
            clientRequest: {
                token,
                recordingConfig: {
                    maxIdleTime: 30,
                    streamTypes: 2,       // audio + video
                    channelType: 0,
                    videoStreamType: 0,
                    transcodingConfig: {
                        height: 640, width: 360,
                        bitrate: 500, fps: 15,
                        mixedVideoLayout: 1
                    }
                },
                storageConfig: storageConfig || {
                    // Default: Agora's own storage (no S3 needed for basic use)
                    vendor: 0,
                    region: 0,
                    bucket: '',
                    accessKey: '',
                    secretKey: ''
                }
            }
        },
        { headers: getAuthHeader() }
    );
    return data.sid;
}

// STEP 3: Stop cloud recording
async function stopRecording(resourceId, sid, channelName, uid = '999') {
    const { data } = await axios.post(
        `${BASE_URL}/resourceid/${resourceId}/sid/${sid}/mode/mix/stop`,
        { cname: channelName, uid, clientRequest: {} },
        { headers: getAuthHeader() }
    );

    const fileList = data.serverResponse?.fileList || [];
    const playbackUrl = fileList.length > 0 ? fileList[0].fileName : null;

    return { fileList, playbackUrl, uploadingStatus: data.serverResponse?.uploadingStatus };
}

// Query recording status
async function queryRecording(resourceId, sid) {
    const { data } = await axios.get(
        `${BASE_URL}/resourceid/${resourceId}/sid/${sid}/mode/mix/query`,
        { headers: getAuthHeader() }
    );
    return data;
}

module.exports = { acquireResource, startRecording, stopRecording, queryRecording };
