import {Optimizer} from '../../dist/optimizer.js';
import type {PreparedStudy} from '../../dist/contracts.js';
export function verifyApi(study:PreparedStudy) {
 const service=new Optimizer({execution:'service',url:'http://127.0.0.1:3001'});
 return service.run(study,{populationSize:4});
}
