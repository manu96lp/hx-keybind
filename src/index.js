const hid = require('node-hid');
const winAudio = require('win-audio');
const robot = require('robotjs');
const childProcess = require("child_process");
const config = require('../config.json');

const deviceInputs = [
    {
        product: 'HyperX Cloud II Wireless',
        type: 'audio-scroll',
        signature: [2, 0],
        usage: 1,
        usagePage: 12,
    },
    {
        product: 'HyperX Cloud II Wireless',
        type: 'mute-button',
        signature: [10, 0, 0, 3],
        usage: 1,
        usagePage: 65299,
    },
];

const eventList = {
    time: 0,
    list: [],
};

const appState = {
    previousVolume: 0,
    currentVolume: 0,
    processId: null,
};

async function waitAsync(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function playBeep(ms) {
    if (ms > 0) {
        childProcess.exec(`powershell.exe [console]::beep(500,${ms})`);
    }
}

function matchEventSignature(baseSign, eventSign) {
    if (!eventSign?.length) {
        return false;
    }

    for (let i = 0; i < baseSign.length; i++) {
        if (baseSign[i] !== eventSign[i]) {
            return false;
        }
    }

    return true;
}

function getInspectableDevices() {
    const devices = hid.devices();
    const inspectableDevices = [];

    devices.forEach((x) => {
        const deviceInput = deviceInputs.find(
            (y) => y.product === x.product && y.usage === x.usage && y.usagePage === x.usagePage
        );

        if (deviceInput) {
            const deviceObj = new hid.HID(x.path);

            if (deviceObj) {
                inspectableDevices.push([deviceObj, deviceInput]);
            }
        }
    });

    return inspectableDevices;
}

function processEventList() {
    let actionToExecute;

    for (let i = 0, j = 0; i < config.actions.length; i++) {
        if (config.actions[i].events.length !== eventList.list.length) {
            continue;
        }

        actionToExecute = config.actions[i];

        for (j = 0; j < eventList.list.length; j++) {
            if (config.actions[i].events[j] !== eventList.list[j]) {
                actionToExecute[i] = null;
                break;
            }
        }
    }
    
    if (actionToExecute) {
        switch (actionToExecute.type) {
            case 'keyboard': 
                robot.keyTap(actionToExecute.value);
                break;

            case 'mouse': 
                robot.mouseClick(actionToExecute.value);
                break;
        }
    }

    eventList.time = 0;
    appState.processId = 0;
}

function updateEventList(eventType) {
    const currentTime = Date.now();

    if (currentTime - eventList.time > config.captureDelay) {
        eventList.list = [];
    }

    eventList.list.push(eventType);
    eventList.time = currentTime;

    if (appState.processId) {
        clearTimeout(appState.processId);
    }

    appState.processId = setTimeout(processEventList, config.captureDelay);
}

async function inspectDevice(device, input) {
    try {
        const result = device.readTimeout(100);
        const isMatch = matchEventSignature(input.signature, result);

        if (!isMatch) {
            return;
        }
        
        updateEventList(input.type);

        if (input.type === 'audio-scroll') {
            playBeep(config.beepLength);

            winAudio.speaker.set(appState.previousVolume);
        }
    } catch {}
}

async function inspectAudio() {
    const volume = winAudio.speaker.get();

    if (volume !== appState.currentVolume) {
        appState.currentVolume = volume;
    }
    
    appState.previousVolume = appState.currentVolume;
}

async function runTaskManager(tasksToRun) {
    const taskState = {
        ticks: 0,
        queue: [],
    };

    do {
        tasksToRun
            .filter((x) => taskState.ticks % x.frequency === 0)
            .forEach((x) => taskState.queue.push(x.callback(...x.params)));

        if (taskState.queue.length > 0) {
            await Promise.all(taskState.queue);
        }

        taskState.ticks++;
        taskState.queue = [];

        await waitAsync(100);
    } while (true);
}

async function main() {
    const devicesToInspect = getInspectableDevices();

    if (!devicesToInspect.length) {
        throw new Error('No devices were found');
    }

    const tasksToRun = [
        { frequency: 10, params: [], callback: inspectAudio },
    ];

    devicesToInspect.forEach((x) => {
        tasksToRun.push({ frequency: 1, params: x, callback: inspectDevice });
    });

    await runTaskManager(tasksToRun);
}

main();
