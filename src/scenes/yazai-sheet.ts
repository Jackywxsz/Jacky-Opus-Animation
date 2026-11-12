// 造型核对：芽仔单独放大（无表情），和定妆图并排比对比例。
import { Timeline } from "../engine/core";
import type { Stage } from "../engine/stage";
import { Yazai } from "../components/yazai";

export function buildYazaiSheet(stage: Stage): Timeline {
  const tl = new Timeline();
  tl.duration = 3;
  const yz = new Yazai(stage.top, 100);
  tl.add((t) => {
    stage.setBoil(t);
    yz.build(t, 0);
    yz.pose({ x: 960, y: 1010, scale: 1.95 });
    yz.setFace(null);
    yz.setMarquee(t > 1.5 ? 1 : 0, t, 1.5);
  });
  return tl;
}
