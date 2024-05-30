/* global Promise, customElements, screen, CustomEvent */
var initMetaTags = require('./metaTags').inject;
var initWakelock = require('./wakelock');
var loadingScreen = require('./loadingScreen');
var scenes = require('./scenes');
var systems = require('../system').systems;
var components = require('../component').components;
var THREE = require('../../lib/three');
var utils = require('../../utils/');
var warn = utils.debug('core:a-scene:warn');
// Require after.
var AEntity = require('../a-entity').AEntity;
var ANode = require('../a-node').ANode;
var initPostMessageAPI = require('./postMessage');

var isIOS = utils.device.isIOS();
var isMobile = utils.device.isMobile();
var isWebXRAvailable = utils.device.isWebXRAvailable;

if (isIOS) { require('../../utils/ios-orientationchange-blank-bug'); }

/**
 * Scene element, holds all entities.
 *
 * @member {array} behaviors - Component instances that have registered themselves to be
           updated on every tick.
 * @member {object} camera - three.js Camera object.
 * @member {object} canvas
 * @member {bool} isScene - Differentiates as scene entity as opposed to other entities.
 * @member {bool} isMobile - Whether browser is mobile (via UA detection).
 * @member {object} object3D - Root three.js Scene object.
 * @member {object} renderer
 * @member {bool} renderStarted
 * @member {object} systems - Registered instantiated systems.
 * @member {number} time
 */

class AScene extends AEntity {
  constructor () {
    var self;
    super();
    self = this;
    self.clock = new THREE.Clock();
    self.isIOS = isIOS;
    self.isMobile = isMobile;
    self.hasWebXR = isWebXRAvailable;
    self.isAR = false;
    self.isScene = true;
    self.object3D = new THREE.Scene();
    self.object3D.onAfterRender = function (renderer, scene, camera) {
      // THREE may swap the camera used for the rendering if in VR, so we pass it to tock
      if (self.isPlaying) { self.tock(self.time, self.delta, camera); }
    };
    self.resize = self.resize.bind(self);
    self.render = self.render.bind(self);
    self.systems = {};
    self.systemNames = [];
    self.time = self.delta = 0;
    self.usedOfferSession = false;

    self.componentOrder = [];
    self.behaviors = {};
    self.hasLoaded = false;
    self.isPlaying = false;
    self.originalHTML = self.innerHTML;
  }

  addFullScreenStyles () {
    document.documentElement.classList.add('a-fullscreen');
  }

  removeFullScreenStyles () {
    document.documentElement.classList.remove('a-fullscreen');
  }

  doConnectedCallback () {
    var self = this;
    var embedded = this.hasAttribute('embedded');

    // Default components.
    this.setAttribute('inspector', '');
    this.setAttribute('keyboard-shortcuts', '');
    this.setAttribute('screenshot', '');
    this.setAttribute('xr-mode-ui', '');
    this.setAttribute('device-orientation-permission-ui', '');
    super.doConnectedCallback();

    // Renderer initialization
    setupCanvas(this);
    this.setupRenderer();
    loadingScreen.setup(this, getCanvasSize);

    this.resize();
    if (!embedded) { this.addFullScreenStyles(); }
    initPostMessageAPI(this);

    initMetaTags(this);
    initWakelock(this);

    // Handler to exit VR (e.g., Oculus Browser back button).
    this.onVRPresentChangeBound = this.onVRPresentChange.bind(this);
    window.addEventListener('vrdisplaypresentchange', this.onVRPresentChangeBound);

    // Bind functions.
    this.enterVRBound = function () { self.enterVR(); };
    this.exitVRBound = function () { self.exitVR(); };
    this.exitVRTrueBound = function () { self.exitVR(true); };
    this.pointerRestrictedBound = function () { self.pointerRestricted(); };
    this.pointerUnrestrictedBound = function () { self.pointerUnrestricted(); };

    if (!self.hasWebXR) {
      // Exit VR on `vrdisplaydeactivate` (e.g. taking off Rift headset).
      window.addEventListener('vrdisplaydeactivate', this.exitVRBound);

      // Exit VR on `vrdisplaydisconnect` (e.g. unplugging Rift headset).
      window.addEventListener('vrdisplaydisconnect', this.exitVRTrueBound);

      // Register for mouse restricted events while in VR
      // (e.g. mouse no longer available on desktop 2D view)
      window.addEventListener('vrdisplaypointerrestricted', this.pointerRestrictedBound);

      // Register for mouse unrestricted events while in VR
      // (e.g. mouse once again available on desktop 2D view)
      window.addEventListener('vrdisplaypointerunrestricted',
                              this.pointerUnrestrictedBound);
    }

    window.addEventListener('sessionend', this.resize);
    // Camera set up by camera system.
    this.addEventListener('cameraready', function () {
      self.attachedCallbackPostCamera();
    });

    this.initSystems();
    // Compute component order
    this.componentOrder = determineComponentBehaviorOrder(components, this.componentOrder);
    this.addEventListener('componentregistered', function () {
      // Recompute order
      self.componentOrder = determineComponentBehaviorOrder(components, self.componentOrder);
    });

    // WebXR Immersive navigation handler.
    if (this.hasWebXR && navigator.xr && navigator.xr.addEventListener) {
      navigator.xr.addEventListener('sessiongranted', function () { self.enterVR(); });
    }
  }

  attachedCallbackPostCamera () {
    var resize;
    var self = this;

    window.addEventListener('load', resize);
    window.addEventListener('resize', function () {
      // Workaround for a Webkit bug (https://bugs.webkit.org/show_bug.cgi?id=170595)
      // where the window does not contain the correct viewport size
      // after an orientation change. The window size is correct if the operation
      // is postponed a few milliseconds.
      // self.resize can be called directly once the bug above is fixed.
      if (self.isIOS) {
        setTimeout(self.resize, 100);
      } else {
        self.resize();
      }
    });
    this.play();

    // Add to scene index.
    scenes.push(this);
  }

  /**
   * Initialize all systems.
   */
  initSystems () {
    var name;

    // Initialize camera system first.
    this.initSystem('camera');

    for (name in systems) {
      if (name === 'camera') { continue; }
      this.initSystem(name);
    }
  }

  /**
   * Initialize a system.
   */
  initSystem (name) {
    if (this.systems[name]) { return; }
    this.systems[name] = new systems[name](this);
    this.systemNames.push(name);
  }

  /**
   * Shut down scene on detach.
   */
  disconnectedCallback () {
    // Remove from scene index.
    var sceneIndex = scenes.indexOf(this);
    super.disconnectedCallback();

    scenes.splice(sceneIndex, 1);

    window.removeEventListener('vrdisplaypresentchange', this.onVRPresentChangeBound);
    window.removeEventListener('vrdisplayactivate', this.enterVRBound);
    window.removeEventListener('vrdisplaydeactivate', this.exitVRBound);
    window.removeEventListener('vrdisplayconnect', this.enterVRBound);
    window.removeEventListener('vrdisplaydisconnect', this.exitVRTrueBound);
    window.removeEventListener('vrdisplaypointerrestricted', this.pointerRestrictedBound);
    window.removeEventListener('vrdisplaypointerunrestricted', this.pointerUnrestrictedBound);
    window.removeEventListener('sessionend', this.resize);
    this.renderer.dispose();
  }

  /**
   * Add ticks and tocks.
   *
   * @param {object} behavior - A component.
   */
  addBehavior (behavior) {
    var behaviorSet;
    var behaviors = this.behaviors[behavior.name];
    var behaviorType;

    if (!behaviors) {
      behaviors = this.behaviors[behavior.name] = {
        tick: { inUse: false, array: [], markedForRemoval: [] },
        tock: { inUse: false, array: [], markedForRemoval: [] }
      };
    }

    // Check if behavior has tick and/or tock and add the behavior to the appropriate list.
    for (behaviorType in behaviors) {
      if (!behavior[behaviorType]) { continue; }
      behaviorSet = behaviors[behaviorType];

      // In case the behaviorSet is in use, make sure this behavior isn't on the removal list.
      if (behaviorSet.inUse) {
        var index = behaviorSet.markedForRemoval.indexOf(behavior);
        if (index !== -1) {
          behaviorSet.markedForRemoval.splice(index, 1);
        }
      }
      // Add behavior to the set
      if (behaviorSet.array.indexOf(behavior) === -1) {
        behaviorSet.array.push(behavior);
      }
    }
  }

  /**
   * For tests.
   */
  getPointerLockElement () {
    return document.pointerLockElement;
  }

  /**
   * For tests.
   */
  checkHeadsetConnected () {
    return utils.device.checkHeadsetConnected();
  }

  enterAR () {
    var errorMessage;
    if (!this.hasWebXR) {
      errorMessage = 'Failed to enter AR mode, WebXR not supported.';
      throw new Error(errorMessage);
    }
    if (!utils.device.checkARSupport()) {
      errorMessage = 'Failed to enter AR, WebXR immersive-ar mode not supported in your browser or device.';
      throw new Error(errorMessage);
    }
    return this.enterVR(true);
  }

  /**
   * Call `requestPresent` if WebVR or WebVR polyfill.
   * Call `requestFullscreen` on desktop.
   * Handle events, states, fullscreen styles.
   *
   * @param {bool?} useAR - if true, try immersive-ar mode
   * @returns {Promise}
   */
  enterVR (useAR, useOfferSession) {
    var self = this;
    var vrDisplay;
    var vrManager = self.renderer.xr;
    var xrInit;

    // Don't enter VR if already in VR.
    if (useOfferSession && (!navigator.xr || !navigator.xr.offerSession)) { return Promise.resolve('OfferSession is not supported.'); }
    if (self.usedOfferSession && useOfferSession) { return Promise.resolve('OfferSession was already called.'); }
    if (this.is('vr-mode')) { return Promise.resolve('Already in VR.'); }

    // Has VR.
    if (this.checkHeadsetConnected() || this.isMobile) {
      var rendererSystem = self.getAttribute('renderer');
      vrManager.enabled = true;

      if (this.hasWebXR) {
        // XR API.
        if (this.xrSession) {
          this.xrSession.removeEventListener('end', this.exitVRBound);
        }
        var refspace = this.sceneEl.systems.webxr.sessionReferenceSpaceType;
        vrManager.setReferenceSpaceType(refspace);
        var xrMode = useAR ? 'immersive-ar' : 'immersive-vr';
        xrInit = this.sceneEl.systems.webxr.sessionConfiguration;
        return new Promise(function (resolve, reject) {
          var requestSession = useOfferSession ? navigator.xr.offerSession.bind(navigator.xr) : navigator.xr.requestSession.bind(navigator.xr);
          self.usedOfferSession |= useOfferSession;
          requestSession(xrMode, xrInit).then(
            function requestSuccess (xrSession) {
              if (useOfferSession) {
                self.usedOfferSession = false;
              }

              vrManager.layersEnabled = xrInit.requiredFeatures.indexOf('layers') !== -1;
              vrManager.setSession(xrSession).then(function () {
                vrManager.setFoveation(rendererSystem.foveationLevel);
                self.xrSession = xrSession;
                self.systems.renderer.setWebXRFrameRate(xrSession);
                xrSession.addEventListener('end', self.exitVRBound);
                enterVRSuccess(resolve);
              });
            },
            function requestFail (error) {
              var useAR = xrMode === 'immersive-ar';
              var mode = useAR ? 'AR' : 'VR';
              reject(new Error('Failed to enter ' + mode + ' mode (`requestSession`)', { cause: error }));
            }
          );
        });
      } else {
        vrDisplay = utils.device.getVRDisplay();
        vrManager.setDevice(vrDisplay);
        if (vrDisplay.isPresenting &&
            !window.hasNativeWebVRImplementation) {
          enterVRSuccess();
          return Promise.resolve();
        }
        var presentationAttributes = {
          highRefreshRate: rendererSystem.highRefreshRate
        };

        return vrDisplay.requestPresent([{
          source: this.canvas,
          attributes: presentationAttributes
        }]).then(enterVRSuccess, enterVRFailure);
      }
    }

    // No VR.
    enterVRSuccess();
    return Promise.resolve();

    // Callback that happens on enter VR success or enter fullscreen (any API).
    function enterVRSuccess (resolve) {
      // vrdisplaypresentchange fires only once when the first requestPresent is completed;
      // the first requestPresent could be called from ondisplayactivate and there is no way
      // to setup everything from there. Thus, we need to emulate another vrdisplaypresentchange
      // for the actual requestPresent. Need to make sure there are no issues with firing the
      // vrdisplaypresentchange multiple times.
      var event;
      if (window.hasNativeWebVRImplementation && !window.hasNativeWebXRImplementation) {
        event = new CustomEvent('vrdisplaypresentchange', {detail: {display: utils.device.getVRDisplay()}});
        window.dispatchEvent(event);
      }

      // Lock to landscape orientation on mobile.
      if (!self.hasWebXR && self.isMobile && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape');
      }
      self.addFullScreenStyles();

      // On mobile, the polyfill handles fullscreen.
      // TODO: 07/16 Chromium builds break when `requestFullscreen`ing on a canvas
      // that we are also `requestPresent`ing. Until then, don't fullscreen if headset
      // connected.
      if (!self.isMobile && !self.checkHeadsetConnected()) {
        requestFullscreen(self.canvas);
      } else {
      if (useAR) {
        self.addState('ar-mode');
      } else {
        self.addState('vr-mode');
        self.emit('enter-vr', {target: self});
      }}

      self.resize();
      if (resolve) { resolve(); }
    }

    function enterVRFailure (err) {
      self.removeState('vr-mode');
      if (err && err.message) {
        throw new Error('Failed to enter VR mode (`requestPresent`): ' + err.message);
      } else {
        throw new Error('Failed to enter VR mode (`requestPresent`).');
      }
    }
  }

   /**
   * Call `exitPresent` if WebVR / WebXR or WebVR polyfill.
   * Handle events, states, fullscreen styles.
   *
   * @returns {Promise}
   */
  exitVR () {
    var self = this;
    var vrDisplay;
    var vrManager = this.renderer.xr;

    // Don't exit VR if not in VR.
    if (!this.is('vr-mode') && !this.is('ar-mode')) { return Promise.resolve('Not in immersive mode.'); }

    // Handle exiting VR if not yet already and in a headset or polyfill.
    if (this.checkHeadsetConnected() || this.isMobile) {
      vrManager.enabled = false;
      vrDisplay = utils.device.getVRDisplay();
      if (this.hasWebXR) {
        this.xrSession.removeEventListener('end', this.exitVRBound);
        // Capture promise to avoid errors.
        this.xrSession.end().then(function () {}, function () {});
        this.xrSession = undefined;
      } else {
        if (vrDisplay.isPresenting) {
          return vrDisplay.exitPresent().then(exitVRSuccess, exitVRFailure);
        }
      }
    } else {
      exitFullscreen();
    }

    // Handle exiting VR in all other cases (2D fullscreen, external exit VR event).
    exitVRSuccess();

    return Promise.resolve();

    function exitVRSuccess () {
      self.removeState('vr-mode');
      self.removeState('ar-mode');
      // Lock to landscape orientation on mobile.
      if (self.isMobile && screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
      // Exiting VR in embedded mode, no longer need fullscreen styles.
      if (self.hasAttribute('embedded')) { self.removeFullScreenStyles(); }

      self.resize();
      if (self.isIOS) { utils.forceCanvasResizeSafariMobile(self.canvas); }
      self.renderer.setPixelRatio(window.devicePixelRatio);
      self.emit('exit-vr', {target: self});
    }

    function exitVRFailure (err) {
      if (err && err.message) {
        throw new Error('Failed to exit VR mode (`exitPresent`): ' + err.message);
      } else {
        throw new Error('Failed to exit VR mode (`exitPresent`).');
      }
    }
  }

  pointerRestricted () {
    if (this.canvas) {
      var pointerLockElement = this.getPointerLockElement();
      if (pointerLockElement && pointerLockElement !== this.canvas && document.exitPointerLock) {
        // Recreate pointer lock on the canvas, if taken on another element.
        document.exitPointerLock();
      }

      if (this.canvas.requestPointerLock) {
        this.canvas.requestPointerLock();
      }
    }
  }

  pointerUnrestricted () {
    var pointerLockElement = this.getPointerLockElement();
    if (pointerLockElement && pointerLockElement === this.canvas && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  /**
   * Handle `vrdisplaypresentchange` event for exiting VR through other means than
   * `<ESC>` key. For example, GearVR back button on Oculus Browser.
   */
  onVRPresentChange (evt) {
    // Polyfill places display inside the detail property
    var display = evt.display || evt.detail.display;
    // Entering VR.
    if (display && display.isPresenting) {
      this.enterVR();
      return;
    }
    // Exiting VR.
    this.exitVR();
  }

  /**
   * Wraps Entity.getAttribute to take into account for systems.
   * If system exists, then return system data rather than possible component data.
   */
  getAttribute (attr) {
    var system = this.systems[attr];
    if (system) { return system.data; }
    return AEntity.prototype.getAttribute.call(this, attr);
  }

  /**
   * Wraps Entity.getDOMAttribute to take into account for systems.
   * If system exists, then return system data rather than possible component data.
   */
  getDOMAttribute (attr) {
    var system = this.systems[attr];
    if (system) { return system.data; }
    return AEntity.prototype.getDOMAttribute.call(this, attr);
  }

  /**
   * Wrap Entity.setAttribute to take into account for systems.
   * If system exists, then skip component initialization checks and do a normal
   * setAttribute.
   */
  setAttribute (attr, value, componentPropValue) {
    // Check if system exists (i.e. is registered).
    if (systems[attr]) {
      ANode.prototype.setAttribute.call(this, attr, value);

      // Update system instance, if initialized on the scene.
      var system = this.systems[attr];
      if (system) {
        system.updateProperties(value);
      }
      return;
    }
    AEntity.prototype.setAttribute.call(this, attr, value, componentPropValue);
  }

  /**
   * @param {object} behavior - A component.
   */
  removeBehavior (behavior) {
    var behaviorSet;
    var behaviorType;
    var behaviors = this.behaviors[behavior.name];
    var index;

    // Check if behavior has tick and/or tock and remove the behavior from the appropriate
    // array.
    for (behaviorType in behaviors) {
      if (!behavior[behaviorType]) { continue; }
      behaviorSet = behaviors[behaviorType];
      index = behaviorSet.array.indexOf(behavior);
      if (index !== -1) {
        // Check if the behavior can safely be removed.
        if (behaviorSet.inUse) {
          // Set is in use, so only mark for removal.
          if (behaviorSet.markedForRemoval.indexOf(behavior) === -1) {
            behaviorSet.markedForRemoval.push(behavior);
          }
        } else {
          // Swap and remove from the end
          behaviorSet.array[index] = behaviorSet.array[behaviorSet.array.length - 1];
          behaviorSet.array.pop();
        }
      }
    }
  }

  resize () {
    var camera = this.camera;
    var canvas = this.canvas;
    var embedded;
    var isVRPresenting;
    var size;
    var isPresenting = this.renderer.xr.isPresenting;
    isVRPresenting = this.renderer.xr.enabled && isPresenting;

    // Do not update renderer, if a camera or a canvas have not been injected.
    // In VR mode, three handles canvas resize based on the dimensions returned by
    // the getEyeParameters function of the WebVR API. These dimensions are independent of
    // the window size, therefore should not be overwritten with the window's width and
    // height, // except when in fullscreen mode.
    if (!camera || !canvas || (this.is('vr-mode') && (this.isMobile || isVRPresenting))) {
      return;
    }

    // Update camera.
    embedded = this.getAttribute('embedded') && !this.is('vr-mode');
    size = getCanvasSize(canvas, embedded, this.maxCanvasSize, this.is('vr-mode'));
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();

    // Notify renderer of size change.
    this.renderer.setSize(size.width, size.height, false);
    this.emit('rendererresize', null, false);
  }

  setupRenderer () {
    var self = this;
    var renderer;
    var rendererAttr;
    var rendererAttrString;
    var rendererConfig;

    rendererConfig = {
      alpha: true,
      antialias: !isMobile,
      canvas: this.canvas,
      logarithmicDepthBuffer: false,
      powerPreference: 'high-performance'
    };

    this.maxCanvasSize = {height: -1, width: -1};

    if (this.hasAttribute('renderer')) {
      rendererAttrString = this.getAttribute('renderer');
      rendererAttr = utils.styleParser.parse(rendererAttrString);

      if (rendererAttr.precision) {
        rendererConfig.precision = rendererAttr.precision + 'p';
      }

      if (rendererAttr.antialias && rendererAttr.antialias !== 'auto') {
        rendererConfig.antialias = rendererAttr.antialias === 'true';
      }

      if (rendererAttr.logarithmicDepthBuffer && rendererAttr.logarithmicDepthBuffer !== 'auto') {
        rendererConfig.logarithmicDepthBuffer = rendererAttr.logarithmicDepthBuffer === 'true';
      }

      if (rendererAttr.alpha) {
        rendererConfig.alpha = rendererAttr.alpha === 'true';
      }

      if (rendererAttr.stencil) {
        rendererConfig.stencil = rendererAttr.stencil === 'true';
      }

      if (rendererAttr.multiviewStereo) {
        rendererConfig.multiviewStereo = rendererAttr.multiviewStereo === 'true';
      }

      this.maxCanvasSize = {
        width: rendererAttr.maxCanvasWidth
          ? parseInt(rendererAttr.maxCanvasWidth)
          : this.maxCanvasSize.width,
        height: rendererAttr.maxCanvasHeight
          ? parseInt(rendererAttr.maxCanvasHeight)
          : this.maxCanvasSize.height
      };
    }

    // still using webgl1 on ios
    const IS_IOS = typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    if(IS_IOS) {
       renderer = this.renderer = new THREE.WebGL1Renderer(rendererConfig);
    } else {
       renderer = this.renderer = new THREE.WebGLRenderer(rendererConfig);
    }

    renderer.setPixelRatio(window.devicePixelRatio)
    /*if (this.camera) { renderer.xr.setPoseTarget(this.camera.el.object3D); }
    this.addEventListener('camera-set-active', function () {
      renderer.xr.setPoseTarget(self.camera.el.object3D);
    });
    */
  }

  /**
   * Handler attached to elements to help scene know when to kick off.
   * Scene waits for all entities to load.
   */
  play () {
    var self = this;
    var sceneEl = this;

    if (this.renderStarted) {
      AEntity.prototype.play.call(this);
      return;
    }

    this.addEventListener('loaded', function () {
      var renderer = this.renderer;
      var vrDisplay;
      var vrManager = this.renderer.xr;
      AEntity.prototype.play.call(this);  // .play() *before* render.

      if (sceneEl.renderStarted) { return; }
      sceneEl.resize();

      // Kick off render loop.
      if (sceneEl.renderer) {
        if (window.performance) { window.performance.mark('render-started'); }
        loadingScreen.remove();
        vrDisplay = utils.device.getVRDisplay();
        if (vrDisplay && vrDisplay.isPresenting) {
          vrManager.setDevice(vrDisplay);
          vrManager.enabled = true;
          sceneEl.enterVR();
        }
        renderer.setAnimationLoop(this.render);
        sceneEl.renderStarted = true;
        sceneEl.emit('renderstart');
      }
    });

    // setTimeout to wait for all nodes to attach and run their callbacks.
    setTimeout(function () {
      AEntity.prototype.load.call(self);
    });
  }

  /**
   * Wrap `updateComponent` to not initialize the component if the component has a system
   * (aframevr/aframe#2365).
   */
  updateComponent (componentName) {
    if (componentName in systems) { return; }
    AEntity.prototype.updateComponent.apply(this, arguments);
  }

  /**
   * Behavior-updater meant to be called from scene render.
   * Abstracted to a different function to facilitate unit testing (`scene.tick()`) without
   * needing to render.
   */
  tick (time, timeDelta) {
    var i;
    var systems = this.systems;

    // Components.
    this.callComponentBehaviors('tick', time, timeDelta);

    // Systems.
    for (i = 0; i < this.systemNames.length; i++) {
      if (!systems[this.systemNames[i]].tick) { continue; }
      systems[this.systemNames[i]].tick(time, timeDelta);
    }
  }

  /**
   * Behavior-updater meant to be called after scene render for post processing purposes.
   * Abstracted to a different function to facilitate unit testing (`scene.tock()`) without
   * needing to render.
   */
  tock (time, timeDelta, camera) {
    var i;
    var systems = this.systems;

    // Components.
    this.callComponentBehaviors('tock', time, timeDelta);

    // Systems.
    for (i = 0; i < this.systemNames.length; i++) {
      if (!systems[this.systemNames[i]].tock) { continue; }
      systems[this.systemNames[i]].tock(time, timeDelta, camera);
    }
  }

  /**
   * The render loop.
   *
   * Updates animations.
   * Updates behaviors.
   * Renders with request animation frame.
   */
  render (time, frame) {
    var renderer = this.renderer;

    this.frame = frame;
    this.delta = this.clock.getDelta() * 1000;
    this.time = this.clock.elapsedTime * 1000;

    if (this.isPlaying) { this.tick(this.time, this.delta); }
    var savedBackground = null;
    if (this.is('ar-mode')) {
      // In AR mode, don't render the default background. Hide it, then
      // restore it again after rendering.
      savedBackground = this.object3D.background;
      this.object3D.background = null;
    }
    renderer.render(this.object3D, this.camera);
    if (savedBackground) {
      this.object3D.background = savedBackground;
    }
  }

  callComponentBehaviors (behavior, time, timeDelta) {
    var i;

    for (var c = 0; c < this.componentOrder.length; c++) {
      var behaviors = this.behaviors[this.componentOrder[c]];
      if (!behaviors) { continue; }
      var behaviorSet = behaviors[behavior];

      behaviorSet.inUse = true;
      for (i = 0; i < behaviorSet.array.length; i++) {
        if (!behaviorSet.array[i].isPlaying) { continue; }
        behaviorSet.array[i][behavior](time, timeDelta);
      }
      behaviorSet.inUse = false;

      // Clean up any behaviors marked for removal
      for (i = 0; i < behaviorSet.markedForRemoval.length; i++) {
        this.removeBehavior(behaviorSet.markedForRemoval[i]);
      }
      behaviorSet.markedForRemoval.length = 0;
    }
  }
}

/**
 * Derives an ordering from the components, taking any before and after
 * constraints into account.
 *
 * @param {object} components - The components to order
 * @param {array} array - Optional array to use as output
 */
function determineComponentBehaviorOrder (components, array) {
  var graph = {};
  var i;
  var key;
  var result = array || [];
  result.length = 0;

  // Construct graph nodes for each element
  for (key in components) {
    var element = components[key];
    if (element === undefined) { continue; }
    var before = element.before ? element.before.slice(0) : [];
    var after = element.after ? element.after.slice(0) : [];
    graph[key] = { before: before, after: after, visited: false, done: false };
  }

  // Normalize to after constraints, warn about missing nodes
  for (key in graph) {
    for (i = 0; i < graph[key].before.length; i++) {
      var beforeName = graph[key].before[i];
      if (!(beforeName in graph)) {
        warn('Invalid ordering constraint, no component named `' + beforeName + '` referenced by `' + key + '`');
        continue;
      }

      graph[beforeName].after.push(key);
    }
  }

  // Perform topological depth-first search
  // https://en.wikipedia.org/wiki/Topological_sorting#Depth-first_search
  function visit (name) {
    if (!(name in graph) || graph[name].done) {
      return;
    }

    if (graph[name].visited) {
      warn('Cycle detected, ignoring one or more before/after constraints. ' +
        'The resulting order might be incorrect');
      return;
    }

    graph[name].visited = true;

    for (var i = 0; i < graph[name].after.length; i++) {
      var afterName = graph[name].after[i];
      if (!(afterName in graph)) {
        warn('Invalid before/after constraint, no component named `' +
            afterName + '` referenced in `' + name + '`');
      }
      visit(afterName);
    }

    graph[name].done = true;
    result.push(name);
  }

  for (key in graph) {
    if (graph[key].done) {
      continue;
    }
    visit(key);
  }
  return result;
}

module.exports.determineComponentBehaviorOrder = determineComponentBehaviorOrder;

/**
 * Return size constrained to maxSize - maintaining aspect ratio.
 *
 * @param {object} size - size parameters (width and height).
 * @param {object} maxSize - Max size parameters (width and height).
 * @returns {object} Width and height.
 */
function constrainSizeTo (size, maxSize) {
  var aspectRatio;
  var pixelRatio = window.devicePixelRatio;

  if (!maxSize || (maxSize.width === -1 && maxSize.height === -1)) {
    return size;
  }

  if (size.width * pixelRatio < maxSize.width &&
    size.height * pixelRatio < maxSize.height) {
    return size;
  }

  aspectRatio = size.width / size.height;

  if ((size.width * pixelRatio) > maxSize.width && maxSize.width !== -1) {
    size.width = Math.round(maxSize.width / pixelRatio);
    size.height = Math.round(maxSize.width / aspectRatio / pixelRatio);
  }

  if ((size.height * pixelRatio) > maxSize.height && maxSize.height !== -1) {
    size.height = Math.round(maxSize.height / pixelRatio);
    size.width = Math.round(maxSize.height * aspectRatio / pixelRatio);
  }

  return size;
}

customElements.define('a-scene', AScene);

/**
 * Return the canvas size where the scene will be rendered.
 * Will be always the window size except when the scene is embedded.
 * The parent size will be returned in that case.
 * the returned size will be constrained to the maxSize maintaining aspect ratio.
 *
 * @param {object} canvasEl - the canvas element
 * @param {boolean} embedded - Is the scene embedded?
 * @param {object} max - Max size parameters
 * @param {boolean} isVR - If in VR
 */
function getCanvasSize (canvasEl, embedded, maxSize, isVR) {
  if (!canvasEl.parentElement) { return {height: 0, width: 0}; }
  if (embedded) {
    var size;
    size = {
      height: canvasEl.parentElement.offsetHeight,
      width: canvasEl.parentElement.offsetWidth
    };
    return constrainSizeTo(size, maxSize);
  }
  return getMaxSize(maxSize, isVR);
}

/**
 * Return the canvas size. Will be the window size unless that size is greater than the
 * maximum size (1920x1920 by default).  The constrained size will be returned in that case,
 * maintaining aspect ratio
 *
 * @param {object} maxSize - Max size parameters (width and height).
 * @param {boolean} isVR - If in VR.
 * @returns {object} Width and height.
 */
function getMaxSize (maxSize, isVR) {
  var size;
  size = {height: document.body.offsetHeight, width: document.body.offsetWidth};
  if (isVR) {
    return size;
  } else {
    return constrainSizeTo(size, maxSize);
  }
}

function requestFullscreen (canvas) {
  canvas =  document.documentElement
  var requestFullscreen =
    canvas.requestFullscreen ||
    canvas.webkitRequestFullscreen ||
    canvas.mozRequestFullScreen ||  // The capitalized `S` is not a typo.
    canvas.msRequestFullscreen;
  // Hide navigation buttons on Android.
  requestFullscreen.apply(canvas, [{navigationUI: 'hide'}]);
}

function exitFullscreen () {
  var fullscreenEl =
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement;
  if (!fullscreenEl) { return; }
  if (document.exitFullscreen) {
    document.exitFullscreen();
  } else if (document.mozCancelFullScreen) {
    document.mozCancelFullScreen();
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen();
  }
}

function setupCanvas (sceneEl) {
  var canvasEl;

  canvasEl = document.createElement('canvas');
  canvasEl.classList.add('a-canvas');
  // Mark canvas as provided/injected by A-Frame.
  canvasEl.dataset.aframeCanvas = true;
  sceneEl.appendChild(canvasEl);

  document.addEventListener('fullscreenchange', onFullScreenChange);
  document.addEventListener('mozfullscreenchange', onFullScreenChange);
  document.addEventListener('webkitfullscreenchange', onFullScreenChange);
  document.addEventListener('MSFullscreenChange', onFullScreenChange);

  // Prevent overscroll on mobile.
  canvasEl.addEventListener('touchmove', function (event) { event.preventDefault(); }, {passive: false});

  // Set canvas on scene.
  sceneEl.canvas = canvasEl;
  sceneEl.emit('render-target-loaded', {target: canvasEl});
  // For unknown reasons a synchronous resize does not work on desktop when
  // entering/exiting fullscreen.
  setTimeout(sceneEl.resize.bind(sceneEl), 0);

  function onFullScreenChange () {
    var fullscreenEl =
      document.fullscreenElement ||
      document.mozFullScreenElement ||
      document.webkitFullscreenElement;
    // No fullscreen element === exit fullscreen
    if (!fullscreenEl) { sceneEl.exitVR(); }
    document.activeElement.blur();
    document.body.focus();
  }
}

module.exports.setupCanvas = setupCanvas;
module.exports.AScene = AScene;
