const fs = require('fs');
const childProcess = require("child_process");
const hid = require('node-hid');
const winAudio = require('win-audio');
const robot = require('robotjs');

let configParameters = null;

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
        signature: [11, 0, 187, 8],
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

function loadConfig() {
    try {
        const fileContent = fs.readFileSync('./config.json', 'utf8');
        const parsedConfig = JSON.parse(fileContent);

        return parsedConfig;
    } catch {
        return null;
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
    let actionToExecute = null;

    for (let i = 0, j = 0; i < configParameters.actions.length; i++) {
        if (configParameters.actions[i].events.length > eventList.list.length) {
            continue;
        }

        actionToExecute = configParameters.actions[i];
        
        for (j = 0; j < configParameters.actions[i].events.length; j++) {
            if (configParameters.actions[i].events[j] !== eventList.list[j]) {
                actionToExecute = null;
                break;
            }
        }

        if (actionToExecute !== null) {
            break;
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

    if (currentTime - eventList.time > configParameters.captureDelay) {
        eventList.list = [];
    }

    eventList.list.push(eventType);
    eventList.time = currentTime;

    if (appState.processId) {
        clearTimeout(appState.processId);
    }

    appState.processId = setTimeout(processEventList, configParameters.captureDelay);
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
            playBeep(configParameters.beepLength);

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
        console.error('No devices were found.');
        return 1;
    }

    configParameters = loadConfig();

    if (!configParameters) {
        console.error('Could not load configurations.');
        return 1;
    }

    const tasksToRun = [
        { frequency: 10, params: [], callback: inspectAudio },
    ];

    devicesToInspect.forEach((x) => {
        tasksToRun.push({ frequency: 1, params: x, callback: inspectDevice });
    });

    await runTaskManager(tasksToRun);

    return 0;
}

main().then((exitCode) => {
    console.log('Press any key to exit...');

    process.exitCode = exitCode;
    
    process.stdin.resume();
    process.stdin.setRawMode(true);

    process.stdin.once('data', () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
    });
});
