/*global define*/
define([
        'require',
        'dojo/_base/declare',
        'dojo/ready',
        'dojo/_base/lang',
        'dojo/_base/event',
        'dojo/on',
        'dijit/_WidgetBase',
        'dijit/_TemplatedMixin',
        'dijit/_WidgetsInTemplateMixin',
        'dijit/form/Button',
        'dijit/form/ToggleButton',
        'dijit/form/DropDownButton',
        'dijit/TooltipDialog',
        './TimelineWidget',
        '../Core/Clock',
        '../Core/ClockStep',
        '../Core/ClockRange',
        '../Core/Ellipsoid',
        '../Core/Iso8601',
        '../Core/FullScreen',
        '../Core/SunPosition',
        '../Core/EventHandler',
        '../Core/FeatureDetection',
        '../Core/MouseEventType',
        '../Core/Cartesian2',
        '../Core/Cartesian3',
        '../Core/JulianDate',
        '../Core/DefaultProxy',
        '../Core/Transforms',
        '../Scene/Scene',
        '../Scene/CentralBody',
        '../Scene/BingMapsTileProvider',
        '../Scene/BingMapsStyle',
        '../Scene/SceneTransitioner',
        '../Scene/SingleTileProvider',
        '../Scene/PerformanceDisplay',
        '../DynamicScene/processCzml',
        '../DynamicScene/DynamicObjectCollection',
        '../DynamicScene/VisualizerCollection',
        'dojo/text!./CesiumWidget.html'
    ], function (
        require,
        declare,
        ready,
        lang,
        event,
        on,
        _WidgetBase,
        _TemplatedMixin,
        _WidgetsInTemplateMixin,
        Button,
        ToggleButton,
        DropDownButton,
        TooltipDialog,
        TimelineWidget,
        Clock,
        ClockStep,
        ClockRange,
        Ellipsoid,
        Iso8601,
        FullScreen,
        SunPosition,
        EventHandler,
        FeatureDetection,
        MouseEventType,
        Cartesian2,
        Cartesian3,
        JulianDate,
        DefaultProxy,
        Transforms,
        Scene,
        CentralBody,
        BingMapsTileProvider,
        BingMapsStyle,
        SceneTransitioner,
        SingleTileProvider,
        PerformanceDisplay,
        processCzml,
        DynamicObjectCollection,
        VisualizerCollection,
        template) {
    "use strict";

    return declare('Cesium.CesiumWidget', [_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin], {
        templateString : template,
        preRender : undefined,
        postSetup : undefined,
        useStreamingImagery : true,
        mapStyle : BingMapsStyle.AERIAL,
        defaultCamera : undefined,
        dayImageUrl : undefined,
        nightImageUrl : undefined,
        specularMapUrl : undefined,
        cloudsMapUrl : undefined,
        bumpMapUrl : undefined,

        constructor : function() {
            this.ellipsoid = Ellipsoid.WGS84;
        },

        postCreate : function() {
            ready(this, '_setupCesium');
        },

        resize : function() {
            var width = this.canvas.clientWidth, height = this.canvas.clientHeight;

            if (typeof this.scene === 'undefined' || (this.canvas.width === width && this.canvas.height === height)) {
                return;
            }

            this.canvas.width = width;
            this.canvas.height = height;

            this.scene.getContext().setViewport({
                x : 0,
                y : 0,
                width : width,
                height : height
            });

            this.scene.getCamera().frustum.aspectRatio = width / height;
        },

        defaultOnObjectRightClickSelected : function(selectedObject) {
            if (selectedObject && selectedObject.dynamicObject) {
                this.cameraCenteredObjectID = selectedObject.dynamicObject.id;
            } else {
                this.cameraCenteredObjectID = undefined;
            }
        },

        onObjectSelected : undefined,
        onObjectRightClickSelected : this.defaultOnObjectRightClickSelected,
        onObjectMousedOver : undefined,
        onLeftMouseDown : undefined,
        onLeftMouseUp : undefined,
        onRightMouseDown : undefined,
        onRightMouseUp : undefined,
        onLeftDrag : undefined,
        onZoom : undefined,
        onCameraToggled : undefined,

        _handleLeftClick : function(e) {
            if (typeof this.onObjectSelected !== 'undefined') {
                // If the user left-clicks, we re-send the selection event, regardless if it's a duplicate,
                // because the client may want to react to re-selection in some way.
                this.selectedObject = this.scene.pick(e.position);
                this.onObjectSelected(this.selectedObject);
            }
        },

        _handleRightClick : function(e) {
            if (typeof this.onObjectRightClickSelected !== 'undefined') {
                // If the user right-clicks, we re-send the selection event, regardless if it's a duplicate,
                // because the client may want to react to re-selection in some way.
                this.selectedObject = this.scene.pick(e.position);
                this.onObjectRightClickSelected(this.selectedObject);
            }
        },

        _handleMouseMove : function(movement) {
            if (typeof this.onObjectMousedOver !== 'undefined') {
                // Don't fire multiple times for the same object as the mouse travels around the screen.
                var mousedOverObject = this.scene.pick(movement.endPosition);
                if (this.mousedOverObject !== mousedOverObject) {
                    this.mousedOverObject = mousedOverObject;
                    this.onObjectMousedOver(mousedOverObject);
                }
            }
            if (typeof this.leftDown !== 'undefined' && this.leftDown && typeof this.onLeftDrag !== 'undefined') {
                this.onLeftDrag(movement);
            } else if (typeof this.rightDown !== 'undefined' && this.rightDown && typeof this.onZoom !== 'undefined') {
                this.onZoom(movement);
            }
        },

        _handleRightDown : function(e) {
            this.rightDown = true;
            if (typeof this.onRightMouseDown !== 'undefined') {
                this.onRightMouseDown(e);
            }
        },

        _handleRightUp : function(e) {
            this.rightDown = false;
            if (typeof this.onRightMouseUp !== 'undefined') {
                this.onRightMouseUp(e);
            }
        },

        _handleLeftDown : function(e) {
            this.leftDown = true;
            if (typeof this.onLeftMouseDown !== 'undefined') {
                this.onLeftMouseDown(e);
            }
        },

        _handleLeftUp : function(e) {
            this.leftDown = false;
            if (typeof this.onLeftMouseUp !== 'undefined') {
                this.onLeftMouseUp(e);
            }
        },

        _handleWheel : function(e) {
            if (typeof this.onZoom !== 'undefined') {
                this.onZoom(e);
            }
        },

        updateSpeedIndicator : function() {
            if (this.animationController.isAnimating()) {
                this.speedIndicator.innerHTML = this.clock.multiplier + 'x realtime';
            } else {
                this.speedIndicator.innerHTML = this.clock.multiplier + 'x realtime (paused)';
            }
        },

        setTimeFromBuffer : function() {
            var clock = this.clock;

            this.animReverse.set('checked', false);
            this.animPause.set('checked', true);
            this.animPlay.set('checked', false);

            var availability = this.dynamicObjectCollection.computeAvailability();
            if (availability.start.equals(Iso8601.MINIMUM_VALUE)) {
                clock.startTime = new JulianDate();
                clock.stopTime = clock.startTime.addDays(1);
                clock.clockRange = ClockRange.UNBOUNDED;
            } else {
                clock.startTime = availability.start;
                clock.stopTime = availability.stop;
                clock.clockRange = ClockRange.LOOP;
            }

            clock.multiplier = 60;
            clock.currentTime = clock.startTime;
            this.timelineControl.zoomTo(clock.startTime, clock.stopTime);
            this.updateSpeedIndicator();
        },

        handleDrop : function(e) {
            e.stopPropagation(); // Stops some browsers from redirecting.
            e.preventDefault();

            var files = e.dataTransfer.files;
            var f = files[0];
            var reader = new FileReader();
            var widget = this;
            reader.onload = function(evt) {
                //CZML_TODO visualizers.removeAllPrimitives(); is not really needed here, but right now visualizers
                //cache data indefinitely and removeAll is the only way to get rid of it.
                //while there are no visual differences, removeAll cleans the cache and improves performance
                widget.visualizers.removeAllPrimitives();
                widget.dynamicObjectCollection.clear();
                processCzml(JSON.parse(evt.target.result), widget.dynamicObjectCollection, f.name);
                widget.setTimeFromBuffer();
            };
            reader.readAsText(f);
        },

        _setupCesium : function() {
            var canvas = this.canvas, ellipsoid = this.ellipsoid, scene, widget = this;

            try {
                scene = this.scene = new Scene(canvas);
            } catch (ex) {
                if (typeof this.onSetupError !== 'undefined') {
                    this.onSetupError(this, ex);
                }
                return;
            }

            this.resize();

            on(canvas, 'contextmenu', event.stop);
            on(canvas, 'selectstart', event.stop);

            var maxTextureSize = scene.getContext().getMaximumTextureSize();
            if (maxTextureSize < 4095) {
                // Mobile, or low-end card
                this.dayImageUrl = this.dayImageUrl || require.toUrl('Images/NE2_50M_SR_W_2048.jpg');
                this.nightImageUrl = this.nightImageUrl || require.toUrl('Images/land_ocean_ice_lights_512.jpg');
            } else {
                // Desktop
                this.dayImageUrl = this.dayImageUrl || require.toUrl('Images/NE2_50M_SR_W_4096.jpg');
                this.nightImageUrl = this.nightImageUrl || require.toUrl('Images/land_ocean_ice_lights_2048.jpg');
                this.specularMapUrl = this.specularMapUrl || require.toUrl('Images/earthspec1k.jpg');
                this.cloudsMapUrl = this.cloudsMapUrl || require.toUrl('Images/earthcloudmaptrans.jpg');
                this.bumpMapUrl = this.bumpMapUrl || require.toUrl('Images/earthbump1k.jpg');
            }

            var centralBody = this.centralBody = new CentralBody(ellipsoid);
            centralBody.showSkyAtmosphere = true;
            centralBody.showGroundAtmosphere = true;

            this._configureCentralBodyImagery();

            scene.getPrimitives().setCentralBody(centralBody);

            var camera = scene.getCamera(), maxRadii = ellipsoid.getRadii().getMaximumComponent();

            camera.position = camera.position.multiplyByScalar(1.5);
            camera.frustum.near = 0.0002 * maxRadii;
            camera.frustum.far = 50.0 * maxRadii;

            this.centralBodyCameraController = camera.getControllers().addCentralBody();

            var handler = new EventHandler(canvas);
            handler.setMouseAction(lang.hitch(this, '_handleLeftClick'), MouseEventType.LEFT_CLICK);
            handler.setMouseAction(lang.hitch(this, '_handleRightClick'), MouseEventType.RIGHT_CLICK);
            handler.setMouseAction(lang.hitch(this, '_handleMouseMove'), MouseEventType.MOVE);
            handler.setMouseAction(lang.hitch(this, '_handleLeftDown'), MouseEventType.LEFT_DOWN);
            handler.setMouseAction(lang.hitch(this, '_handleLeftUp'), MouseEventType.LEFT_UP);
            handler.setMouseAction(lang.hitch(this, '_handleWheel'), MouseEventType.WHEEL);
            handler.setMouseAction(lang.hitch(this, '_handleRightDown'), MouseEventType.RIGHT_DOWN);
            handler.setMouseAction(lang.hitch(this, '_handleRightUp'), MouseEventType.RIGHT_UP);

            //////////////////////////////////////////////////////////////////////////////////////////////////

            var animationController = this.animationController;
            var dynamicObjectCollection = this.dynamicObjectCollection = new DynamicObjectCollection();
            var clock = this.clock;
            var transitioner = this.sceneTransitioner = new SceneTransitioner(scene);
            this.visualizers = VisualizerCollection.createCzmlStandardCollection(scene, dynamicObjectCollection);

            this.lastTimeLabelUpdate = clock.currentTime;
            this.timeLabelElement = document.getElementById('dijit_form_Button_0_label');    // TODO: ** FIX THIS **
            this.timeLabelElement.innerHTML = clock.currentTime.toDate().toUTCString();

            this.updateSpeedIndicator();

            var animReverse = this.animReverse;
            var animPause = this.animPause;
            var animPlay = this.animPlay;

            on(this.animReset, 'Click', function() {
                animationController.reset();
                animReverse.set('checked', false);
                animPause.set('checked', true);
                animPlay.set('checked', false);
                widget.updateSpeedIndicator();
            });

            function onAnimPause() {
                animationController.pause();
                animReverse.set('checked', false);
                animPause.set('checked', true);
                animPlay.set('checked', false);
                widget.updateSpeedIndicator();
            }

            on(animPause, 'Click', onAnimPause);

            on(animReverse, 'Click', function() {
                animationController.playReverse();
                animReverse.set('checked', true);
                animPause.set('checked', false);
                animPlay.set('checked', false);
                widget.updateSpeedIndicator();
            });

            on(animPlay, 'Click', function() {
                animationController.play();
                animReverse.set('checked', false);
                animPause.set('checked', false);
                animPlay.set('checked', true);
                widget.updateSpeedIndicator();
            });

            on(widget.animSlow, 'Click', function() {
                animationController.slower();
                widget.updateSpeedIndicator();
            });

            on(widget.animFast, 'Click', function() {
                animationController.faster();
                widget.updateSpeedIndicator();
            });

            function onTimelineScrub(e) {
                widget.clock.currentTime = e.timeJulian;
                onAnimPause();
            }

            var timelineWidget = widget.timelineWidget;
            timelineWidget.clock = widget.clock;
            timelineWidget.setupCallback = function(t) {
                this.timelineControl = t;
                t.addEventListener('settime', onTimelineScrub, false);
                t.zoomTo(clock.startTime, clock.stopTime);
            };
            timelineWidget.setupTimeline();

            var viewHomeButton = widget.viewHomeButton;
            var view2D = widget.view2D;
            var view3D = widget.view3D;
            var viewColumbus = widget.viewColumbus;
            var viewFullScreen = widget.viewFullScreen;

            view2D.set('checked', false);
            view3D.set('checked', true);
            viewColumbus.set('checked', false);

            on(viewFullScreen, 'Click', function() {
                if (FullScreen.isFullscreenEnabled()) {
                    FullScreen.exitFullscreen();
                } else {
                    FullScreen.requestFullScreen(document.body);
                }
            });

            on(viewHomeButton, 'Click', function() {
                view2D.set('checked', false);
                view3D.set('checked', true);
                viewColumbus.set('checked', false);
                transitioner.morphTo3D();
                widget.viewHome();
                widget.showSkyAtmosphere(true);
                widget.showGroundAtmosphere(true);
            });
            on(view2D, 'Click', function() {
                widget.cameraCenteredObjectID = undefined;
                view2D.set('checked', true);
                view3D.set('checked', false);
                viewColumbus.set('checked', false);
                widget.showSkyAtmosphere(false);
                widget.showGroundAtmosphere(false);
                transitioner.morphTo2D();
            });
            on(view3D, 'Click', function() {
                widget.cameraCenteredObjectID = undefined;
                view2D.set('checked', false);
                view3D.set('checked', true);
                viewColumbus.set('checked', false);
                transitioner.morphTo3D();
                widget.showSkyAtmosphere(true);
                widget.showGroundAtmosphere(true);
            });
            on(viewColumbus, 'Click', function() {
                widget.cameraCenteredObjectID = undefined;
                view2D.set('checked', false);
                view3D.set('checked', false);
                viewColumbus.set('checked', true);
                widget.showSkyAtmosphere(false);
                widget.showGroundAtmosphere(false);
                transitioner.morphToColumbusView();
            });

            var cbLighting = widget.cbLighting;
            on(cbLighting, 'Change', function(value) {
                widget.centralBody.affectedByLighting = !value;
            });

            var imagery = widget.imagery;
            var imageryAerial = widget.imageryAerial;
            var imageryAerialWithLabels = widget.imageryAerialWithLabels;
            var imageryRoad = widget.imageryRoad;
            var imagerySingleTile = widget.imagerySingleTile;
            var imageryOptions = [imageryAerial, imageryAerialWithLabels, imageryRoad, imagerySingleTile];
            var bingHtml = imagery.containerNode.innerHTML;

            function createImageryClickFunction(control, style) {
                return function() {
                    if (style) {
                        widget.setStreamingImageryMapStyle(style);
                        imagery.containerNode.innerHTML = bingHtml;
                    } else {
                        widget.enableStreamingImagery(false);
                        imagery.containerNode.innerHTML = 'Imagery';
                    }

                    imageryOptions.forEach(function(o) {
                        o.set('checked', o === control);
                    });
                };
            }

            on(imageryAerial, 'Click', createImageryClickFunction(imageryAerial, BingMapsStyle.AERIAL));
            on(imageryAerialWithLabels, 'Click', createImageryClickFunction(imageryAerialWithLabels, BingMapsStyle.AERIAL_WITH_LABELS));
            on(imageryRoad, 'Click', createImageryClickFunction(imageryRoad, BingMapsStyle.ROAD));
            on(imagerySingleTile, 'Click', createImageryClickFunction(imagerySingleTile, undefined));

            //////////////////////////////////////////////////////////////////////////////////////////////////

            if (typeof this.postSetup !== 'undefined') {
                this.postSetup(this);
            }

            this.defaultCamera = camera.clone();
        },

        viewHome : function() {
            var camera = this.scene.getCamera();
            camera.position = this.defaultCamera.position;
            camera.direction = this.defaultCamera.direction;
            camera.up = this.defaultCamera.up;
            camera.transform = this.defaultCamera.transform;
            camera.frustum = this.defaultCamera.frustum.clone();

            var controllers = camera.getControllers();
            controllers.removeAll();
            this.centralBodyCameraController = controllers.addCentralBody();
        },

        areCloudsAvailable : function() {
            return typeof this.centralBody.cloudsMapSource !== 'undefined';
        },

        enableClouds : function(useClouds) {
            if (this.areCloudsAvailable()) {
                this.centralBody.showClouds = useClouds;
                this.centralBody.showCloudShadows = useClouds;
            }
        },

        enableStatistics : function(showStatistics) {
            if (typeof this._performanceDisplay === 'undefined' && showStatistics) {
                this._performanceDisplay = new PerformanceDisplay();
                this.scene.getPrimitives().add(this._performanceDisplay);
            } else if (typeof this._performanceDisplay !== 'undefined' && !showStatistics) {
                this.scene.getPrimitives().remove(this._performanceDisplay);
                this._performanceDisplay = undefined;
            }
        },

        showSkyAtmosphere : function(show) {
            this.centralBody.showSkyAtmosphere = show;
        },

        showGroundAtmosphere : function(show) {
            this.centralBody.showGroundAtmosphere = show;
        },

        enableStreamingImagery : function(value) {
            this.useStreamingImagery = value;
            this._configureCentralBodyImagery();
        },

        setStreamingImageryMapStyle : function(value) {
            this.useStreamingImagery = true;

            if (this.mapStyle !== value) {
                this.mapStyle = value;
                this._configureCentralBodyImagery();
            }
        },

        setLogoOffset : function(logoOffsetX, logoOffsetY) {
            var logoOffset = this.centralBody.logoOffset;
            if ((logoOffsetX !== logoOffset.x) || (logoOffsetY !== logoOffset.y)) {
                this.centralBody.logoOffset = new Cartesian2(logoOffsetX, logoOffsetY);
            }
        },

        _cameraCenteredObjectIDPosition : new Cartesian3(),

        update : function(currentTime) {
            //var currentTime = this.animationController.update();
            var cameraCenteredObjectID = this.cameraCenteredObjectID;
            var cameraCenteredObjectIDPosition = this._cameraCenteredObjectIDPosition;

            this.timelineControl.updateFromClock();
            this.visualizers.update(currentTime);

            this.scene.setSunPosition(SunPosition.compute(currentTime).position);

            if (Math.abs(currentTime.getSecondsDifference(this.lastTimeLabelUpdate)) >= 1.0) {
                this.timeLabelElement.innerHTML = currentTime.toDate().toUTCString();
                this.lastTimeLabelUpdate = currentTime;
            }

            // Update the camera to stay centered on the selected object, if any.
            if (cameraCenteredObjectID) {
                var dynamicObject = this.dynamicObjectCollection.getObject(cameraCenteredObjectID);
                if (dynamicObject && dynamicObject.position) {
                    cameraCenteredObjectIDPosition = dynamicObject.position.getValueCartesian(currentTime, cameraCenteredObjectIDPosition);
                    if (typeof cameraCenteredObjectIDPosition !== 'undefined') {
                        // If we're centering on an object for the first time, zoom to within 2km of it.
                        if (this._lastCameraCenteredObjectID !== cameraCenteredObjectID) {
                            var camera = this.scene.getCamera();
                            camera.position = camera.position.normalize().multiplyByScalar(5000.0);

                            var controllers = camera.getControllers();
                            controllers.removeAll();
                            this.objectSpindleController = controllers.addSpindle();
                            this.objectSpindleController.constrainedAxis = Cartesian3.UNIT_Z;
                        }

                        if (typeof spindleController !== 'undefined' && !this.objectSpindleController.isDestroyed()) {
                            var transform = Transforms.eastNorthUpToFixedFrame(cameraCenteredObjectIDPosition, this.ellipsoid);
                            this.objectSpindleController.setReferenceFrame(transform, Ellipsoid.UNIT_SPHERE);
                        }
                    }
                }
            }
            this._lastCameraCenteredObjectID = cameraCenteredObjectID;
            //widget.render();
            //requestAnimationFrame(update);
        },

        render : function() {
            this.scene.render();
        },

        _configureCentralBodyImagery : function() {
            var centralBody = this.centralBody;

            if (this.useStreamingImagery) {
                centralBody.dayTileProvider = new BingMapsTileProvider({
                    server : 'dev.virtualearth.net',
                    mapStyle : this.mapStyle,
                    // Some versions of Safari support WebGL, but don't correctly implement
                    // cross-origin image loading, so we need to load Bing imagery using a proxy.
                    proxy : FeatureDetection.supportsCrossOriginImagery() ? undefined : new DefaultProxy('/proxy/')
                });
            } else {
                centralBody.dayTileProvider = new SingleTileProvider(this.dayImageUrl);
            }

            centralBody.nightImageSource = this.nightImageUrl;
            centralBody.specularMapSource = this.specularMapUrl;
            centralBody.cloudsMapSource = this.cloudsMapUrl;
            centralBody.bumpMapSource = this.bumpMapUrl;
        }
    });
});