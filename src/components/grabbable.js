import { registerComponent } from '../core/component.js';

registerComponent('agrabbable', {
  init: function () {
    this.el.setAttribute('obb-collider', 'centerModel: true');
  }
});
