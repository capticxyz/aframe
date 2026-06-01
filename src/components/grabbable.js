import { registerComponent } from '../core/component.js';

registerComponent('grabbable-aframe', {
  init: function () {
    this.el.setAttribute('obb-collider', 'centerModel: true');
  }
});
