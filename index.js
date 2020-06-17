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
            let promise = client.send('DOM.resolveNode', { nodeId });
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

    console.log(eventListeners);

    // const elementBoxModel = (await Promise.all(
    //     eventListeners.map(eventEl => {
    //         let boxModel = client.send('DOM.getBoxModel', { nodeId: eventEl.nodeId });
    //         boxModel = boxModel.then(({ model }) => { eventEl.size = model.width * model.height; return model; }).catch(err => console.log(err));
    //         return boxModel;
    //     })
    // ));
    

    // for (let eventEl of eventListeners) { console.log(eventEl.listeners); } 
    // console.log(eventListeners.length, eventListeners);

    // sort by padding edge
    
    await browser.close();
})();
