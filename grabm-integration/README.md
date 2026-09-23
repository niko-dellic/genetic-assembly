# @genetic-assembly/grabm

Optional bounded-graph optimization for grabm using its public APIs. Install the grabm, SDK and integration tarballs together. `defineGrabmStudy` accepts a baseline, declared nodes/links/facility sites, program presets and objective mappings. It preserves population and authored demand while changing the physical design.

The default cost is an explicitly synthetic proxy: facility capacity + 10 per facility + 0.01 per metre of active links. Supply a project-specific measurement function for real decisions.

`openGrabmReplay` from `/browser` reopens retained datasets through grabm's immutable reader.

The same study runs in Node and browsers. Node uses grabm's public batch API and packaged child entry point; browsers use its owned simulation worker. Baseline and selected replay datasets use portable byte resources and open through the same readers. The default 15-minute coverage goal is constant in the tiny example; customize goal measurements for your application's scale.
