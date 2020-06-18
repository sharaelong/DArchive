const process = require('process');
const puppeteer = require('puppeteer');

const DEBUG = !!process.env.DEBUG;
const targetEventTypes = ['click'];

const url = 'https://old.reddit.com/r/programming/comments/fnjpaq/excalidraw_now_supports_real_time_end_to_end/';

(async () => {
    const browser = await puppeteer.launch({ headless: !DEBUG });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (!new URL(request.url()).host.includes("reddit")) {
            request.abort();
        } else {
            request.continue();
        }
    });
    await page.goto(url);

    const client = await page.target().createCDPSession();
    const {
        root: {
            nodeId: documentNodeId
        }
    } = await client.send('DOM.getDocument');
    const {
        nodeIds
    } = await client.send('DOM.querySelectorAll', {
        nodeId: documentNodeId,
        selector: '*'
    });
    const eventListeners = (await Promise.all(
        nodeIds.map(nodeId => {
            let promise = client.send('DOM.resolveNode', { nodeId }).catch(err => {});
            promise = promise.then(({ object: { objectId } }) => {
                let eventListenersPromise = client.send('DOMDebugger.getEventListeners', { objectId });
                return eventListenersPromise;
            }).then(({ listeners }) => {
                let boxModel = client.send('DOM.getBoxModel', { nodeId });
                boxModel = boxModel.then(({ model }) => {
                    let size = model.width * model.height;
                    return ({ nodeId, listeners, size });
                }).catch(err => {});
                return boxModel;
            });
            return promise;
        })
    )) // objectId: Runtime.RemoteObjectId, nodeId: DOM.NodeId
          .filter(eventEl => eventEl)
          .filter(eventEl => eventEl.listeners.some(({ type }) => targetEventTypes.includes(type)));

    // console.log(eventListeners);

    const nodeList = (await Promise.all(
        eventListeners.map(eventEl => {
            let node = client.send('DOM.describeNode', { nodeId: eventEl.nodeId });
            return node;
        })
    ));

    // dispatch event prototype
    let temp = nodeList[2].node.attributes;
    console.log(temp);
    for (let i = 0; 2 * i < temp.length; i++) {
        console.log("??");
            if (temp[2 * i] === 'class') {
                let classKey = temp[2 * i + 1].trim().split(" ");
                console.log(classKey);
                await page.evaluate(classKey => {
                    console.log("Waiting...");
                    document.querySelector(`.${classKey[0]}`).dispatchEvent(new Event('click'));
                    console.log("Dispatched!");
                }, classKey);
            }
        }

    await browser.close();
})();
