/* Food Quiz: explicit pictured foods and verifiable clue combinations. */
(function(root,factory){const bank=factory();if(typeof module==='object'&&module.exports)module.exports=bank;if(root)root.FoodQuizBank=bank;})(typeof window==='undefined'?null:window,function(){
'use strict';
const originalArt = {
 rice:'<path d="M41 114Q45 54 120 54T199 114" fill="#fffdf4" stroke="#dcc9a6" stroke-width="3"/><path d="M36 109H204Q197 179 120 179T36 109" fill="#73a998"/><path d="M54 127Q120 150 186 127" fill="none" stroke="#bdd7bf" stroke-width="8"/><path d="M92 176H148V186H92" fill="#568a7b"/><g stroke="#e6dfce" stroke-width="4" stroke-linecap="round"><path d="M74 85l8 3m17-19 7 3m22 16 8-3m23-12 7 5m-57 18 7-2m58 4 7 4"/></g>',
 onigiri:'<path d="M105 40Q120 20 135 40L203 145Q218 169 188 179H52Q22 169 37 145Z" fill="#fffdf5" stroke="#dfd6bf" stroke-width="4"/><path d="M91 114Q120 105 149 114V179H91Z" fill="#344e3d"/><path d="M103 126V169m12-45v43" stroke="#53634a" stroke-width="4" stroke-linecap="round"/>',
 bread:'<path d="M57 100C24 84 41 34 78 40Q119 13 160 40C200 34 216 83 183 100V177H57Z" fill="#c98947" stroke="#9e652f" stroke-width="4"/><path d="M70 96C47 79 58 50 85 55Q120 31 154 55C181 51 194 78 170 96V162H70Z" fill="#ffe9b0"/><path d="M89 77q7-10 14-9m31-9 14 5" stroke="#f3d28a" stroke-width="5" stroke-linecap="round"/>',
 egg:'<path d="M58 56C85 29 108 48 127 42C160 23 186 47 184 69C218 83 212 125 189 132C178 169 140 157 121 166C94 186 60 166 59 147C20 139 21 108 39 94C25 74 31 68 58 56Z" fill="#fffdfa" stroke="#e8dbc4" stroke-width="3"/><circle cx="122" cy="103" r="42" fill="#f5b52d"/><path d="M98 91q8-15 25-16" fill="none" stroke="#ffdb6d" stroke-width="8" stroke-linecap="round"/>',
 noodles:'<path d="M38 109H202L178 169Q120 199 62 169Z" fill="#da7758"/><path d="M45 119Q120 147 195 119" fill="none" stroke="#f3af8a" stroke-width="7"/><ellipse cx="120" cy="107" rx="82" ry="27" fill="#946039"/><g fill="none" stroke="#f5d58d" stroke-width="6" stroke-linecap="round"><path d="M64 111q13-30 26 0t26 0t26 0t26 0m-93-6q12-28 25 0t26 0t26 0t26 0M111 107V46q0-12 9-12t9 12v58m10 0V37q0-12 9-12t9 12v58"/></g><path d="M95 26 210 44m-112-7 109 20" stroke="#735032" stroke-width="6" stroke-linecap="round"/>',
 carrot:'<path d="M112 64Q155 40 175 83Q182 111 67 182Q57 186 61 172Z" fill="#ee8839" stroke="#cf6626" stroke-width="3"/><path d="M141 60Q110 21 134 17Q151 20 151 54Q159 9 181 19Q192 34 163 59Q197 35 203 55Q200 72 169 72" fill="#6e9c4c"/><path d="m104 96 22 15m5-45 20 13m-67 53 16 11" stroke="#d86c2b" stroke-width="5" stroke-linecap="round"/>',
 tomato:'<path d="M118 67C63 34 30 83 43 131C57 185 108 185 121 176C153 195 196 161 201 119C207 74 166 41 118 67" fill="#e66a50" stroke="#c34e38" stroke-width="3"/><path d="m121 68-37-14 17 27-37 4 37 12 22-14 25 15-5-24 30-12-36 1 2-22Z" fill="#63904e"/><path d="M76 108q-15 15-10 32" fill="none" stroke="#f89675" stroke-width="9" stroke-linecap="round"/>',
 cucumber:'<path d="M53 165C82 131 101 57 161 30C182 20 196 38 186 55C146 105 131 157 78 187C56 199 37 183 53 165Z" fill="#629652" stroke="#416f40" stroke-width="4"/><path d="M67 174C117 138 133 78 175 43" fill="none" stroke="#a0bd69" stroke-width="7" stroke-linecap="round"/><g fill="#3d7743"><circle cx="112" cy="109" r="3"/><circle cx="134" cy="77" r="3"/><circle cx="93" cy="144" r="3"/><circle cx="146" cy="96" r="3"/></g>',
 banana:'<path d="M49 62Q96 155 177 63L185 44L198 48L191 76Q182 164 106 180Q40 190 36 97Z" fill="#f5c84b" stroke="#d8a12e" stroke-width="4"/><path d="M47 91Q88 169 174 106" fill="none" stroke="#ffe880" stroke-width="9" stroke-linecap="round"/><path d="m183 47 3-12 13 3-2 12M39 100l-7-12 10-7 9 12" fill="#82633a"/>',
 apple:'<path d="M121 67C67 28 24 73 43 126C57 176 82 188 120 173C160 189 191 157 201 113C211 65 167 32 121 67Z" fill="#d95048" stroke="#bd403a" stroke-width="3"/><path d="M122 68q-6-27 8-42" fill="none" stroke="#805533" stroke-width="8" stroke-linecap="round"/><path d="M133 47q5-36 47-20-16 33-47 20" fill="#7a9d4d"/><path d="M71 87q-13 13-11 30" fill="none" stroke="#f58d78" stroke-width="9" stroke-linecap="round"/>',
 strawberry:'<path d="M120 67C65 28 27 65 47 108Q73 162 112 184Q120 189 129 182Q180 143 195 100C209 58 163 33 120 67Z" fill="#df6054" stroke="#bf4840" stroke-width="3"/><path d="m121 71-41-35 10 34-29 1 38 19 24-14 28 15 28-21-33 0 14-32Z" fill="#6c984f"/><g fill="#ffe7a3"><ellipse cx="80" cy="110" rx="3" ry="5" transform="rotate(-20 80 110)"/><ellipse cx="114" cy="104" rx="3" ry="5"/><ellipse cx="152" cy="109" rx="3" ry="5" transform="rotate(20 152 109)"/><ellipse cx="103" cy="139" rx="3" ry="5"/><ellipse cx="137" cy="141" rx="3" ry="5"/><ellipse cx="119" cy="166" rx="3" ry="5"/></g>',
 fish:'<path d="M69 108Q116 35 181 84Q221 106 179 134Q118 179 69 108L28 75V146Z" fill="#82afbc" stroke="#557e8e" stroke-width="4"/><path d="M140 69q-22 36 0 76M110 76l11-27 27 17m-43 78 13 21 27-18" fill="#a3c4c7" stroke="#557e8e" stroke-width="3"/><circle cx="172" cy="102" r="6" fill="#384b50"/><path d="m92 99 9 9-9 9m23-20 9 9-9 9" fill="none" stroke="#d3e6de" stroke-width="4"/>'
 };
const wrap=body=>'<svg viewBox="0 0 240 210" aria-hidden="true" focusable="false"><ellipse cx="120" cy="187" rx="84" ry="9" fill="#715a3012"/>'+body+'</svg>';
const path=(d,fill,stroke='none',width=3)=>'<path d="'+d.replace(/-\s+(?=\d)/g,'-')+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+width+'" stroke-linecap="round" stroke-linejoin="round"/>';
const ellipse=(x,y,rx,ry,fill,stroke='none')=>'<ellipse cx="'+x+'" cy="'+y+'" rx="'+rx+'" ry="'+ry+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="3"/>';
const circle=(x,y,r,fill)=>ellipse(x,y,r,r,fill);
const line=(d,color,width=4)=>path(d,'none',color,width);
const plate=ellipse(120,152,100,36,'#f4f2e9','#d4d6cc')+ellipse(120,150,84,24,'#e5ebe4');
const leaf=(x,y)=>path('M'+x+' '+y+'q5-31 39-25-9 32-39 25','#699653');
const art={...originalArt,
 grapes:line('M121 39q-5-17 13-24','#7b593b',7)+leaf(123,40)+[[87,65],[122,66],[157,65],[72,99],[105,99],[140,99],[171,96],[90,133],[124,133],[155,130],[108,163],[138,161],[124,184]].map(([x,y])=>circle(x,y,21,'#8870aa')+circle(x-6,y-7,5,'#b6a4cc')).join(''),
 orange:circle(120,116,72,'#f3a342')+leaf(126,49)+line('M118 50l8-22','#866137',7)+line('M76 96q-9 14-7 30','#ffd087',8)+[[99,68],[152,103],[101,154],[165,143],[130,168]].map(([x,y])=>circle(x,y,2,'#d8842a')).join(''),
 watermelon:path('M31 65H209Q198 160 120 186Q42 159 31 65','#4c985c','#387548')+path('M39 65H201Q186 143 120 171Q57 145 39 65','#d7e5a0')+path('M48 65H192Q176 133 120 157Q66 132 48 65','#ea7764')+[[79,87],[120,87],[159,86],[99,116],[138,114],[120,139]].map(([x,y])=>ellipse(x,y,3,6,'#675047')).join(''),
 peach:path('M119 64C79 31 30 62 41 112Q48 169 120 185Q195 159 201 110C205 65 162 33 119 64','#eea898','#d9897c')+path('M118 62q18 57 0 119','none','#d98478',4)+leaf(121,57)+line('M65 91q-10 18-4 32','#ffd2b8',8),
 pear:path('M94 56Q119 37 139 57Q142 96 171 116Q204 150 175 177Q133 202 77 181Q35 163 58 126Q94 92 94 56','#b6bb60','#8e984b')+line('M116 54q-3-22 9-32','#7b593c',7)+leaf(124,40)+[[97,130],[138,105],[151,154],[83,153],[117,173]].map(([x,y])=>circle(x,y,2,'#8f974d')).join(''),
 pineapple:path('M80 77Q120 57 161 77L178 155Q170 190 119 192Q67 189 62 155Z','#dfb751','#bb9140')+path('m93 79-21-48 31 22-1-45 23 40 23-39-3 44 31-21-19 48','#699651','#4f7b42')+line('m80 95 85 76M69 121l65 63M104 77l70 64M158 88l-86 82m97-54-72 71m34-108-64 62','#b78e35',3),
 kiwi:ellipse(97,119,69,64,'#9f7b4e','#7f603d')+ellipse(139,119,64,65,'#93b953','#8f7046')+ellipse(139,119,49,51,'#b5d074')+ellipse(139,119,18,29,'#f1e6b2')+Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return ellipse(Math.round(139+34*Math.cos(a)),Math.round(119+38*Math.sin(a)),2,4,'#4d5039');}).join(''),
 cherry:line('M77 111Q118 56 133 31Q158 77 169 124','#73914b',6)+leaf(132,42)+circle(77,138,40,'#d66558')+circle(168,149,39,'#c95149')+line('M58 124l-6 12m101-1-6 11','#f29d86',7),
 lemon:path('M41 94Q52 51 111 53Q169 48 195 91L208 109L196 125Q174 169 113 175Q58 172 42 139L30 119Z','#f0ce4e','#d1ad31')+line('M64 105q21-26 52-28','#ffe998',8)+leaf(178,65),
 melon:ellipse(120,119,82,72,'#b3be73','#88944f')+line('M117 47V24m-23 0h50','#6f8c45',7)+line('M59 74l121 81M43 111l98 68M99 50l98 67M184 73l-118 85M198 110l-98 70M144 50l-99 70','#e2dfa5',4),
 potato:path('M72 60Q109 37 170 69Q203 96 189 137Q178 179 132 179Q88 196 50 155Q25 127 44 90Z','#c5a16b','#a27e4b')+[[78,88],[145,80],[165,126],[103,144],[64,131]].map(([x,y])=>path('M'+(x-4)+' '+y+'q4 6 8 0','none','#947048',3)).join(''),
 sweetpotato:path('M35 142Q81 81 156 49Q186 38 207 64Q213 100 165 143Q107 189 55 176Z','#a26778','#824c63')+ellipse(67,154,30,23,'#f4d983','#a26778')+line('M111 115l11-8m34-25 12-7m-14 49 13-9','#c59099',4),
 pumpkin:ellipse(120,124,88,67,'#de9742','#b87930')+ellipse(120,124,55,67,'#e9a94c','#c38938')+ellipse(120,124,23,67,'#f0b95d','#d59842')+path('M110 58l2-29 17-4 9 35','#64824b','#4b693b'),
 eggplant:path('M69 76Q106 48 140 80Q186 136 189 153Q202 182 163 190Q91 199 62 137Q48 102 69 76','#76608b','#59466d')+path('m91 74-32 6 19-21-2-22 23 16 24-11-2 24 22 18-29-1-9 19Z','#709250','#55713d')+line('M97 52q1-22-12-30','#628345',7)+line('M92 111q5 24 24 35','#a18bab',8),
 corn:path('M72 68Q120 26 164 67L164 156Q128 193 77 160Z','#efc64f','#c7a138')+Array.from({length:7},(_,r)=>Array.from({length:5},(_,c)=>ellipse(87+c*16,72+r*14,6,5,'#f8da76','#d4ad39')).join('')).join('')+path('M75 176Q29 138 38 88Q71 113 102 182M164 174Q199 141 199 88Q159 120 137 183','#83a65b','#628546'),
 broccoli:path('M98 168l5-72h30l10 72 21 17H82Z','#97b879','#6f9657')+line('M116 139 75 87m51 39 41-42','#97b879',15)+[[75,93,34],[104, 65,37],[143,67,35],[169,99,35],[121,102,35]].map(([x,y,r])=>circle(x,y,r,'#608a52')).join(''),
 cabbage:ellipse(120,121,84,69,'#9ebc79','#6d9959')+path('M120 183Q45 150 73 72Q126 67 142 147M121 181Q192 145 164 73Q125 78 103 144','none','#d4ddad',6)+path('M50 108q42 0 69 66m70-67q-41 11-64 64M93 56q15 28 22 53m32-53q-12 34-17 63','none','#749a5c',4),
 onion:path('M117 48Q145 52 179 91Q215 144 163 177Q119 198 74 176Q29 145 62 94Q96 65 108 46L106 26L127 29Z','#ddb977','#b18c51')+path('M112 57Q71 118 91 171m34-116q48 57 25 116M119 68v108','none','#edcf95',5)+line('M105 184l-6 12m18-12v13m13-13 8 10','#a18559',3),
 radish:path('M91 68Q118 47 148 70Q173 102 143 156L114 191Q93 156 78 111Q73 83 91 68Z','#f6f1df','#d7d6b8')+path('M97 69Q63 46 75 19Q94 22 112 61Q97 9 119 10Q135 18 125 62Q144 9 163 24Q165 50 139 70','#80a561','#5e8b4f')+line('M98 106l17 3m-9 26 15 3m-8 18 12 2','#d7d2ba',3),
 mushroom:path('M100 100H143L158 175Q119 195 83 175Z','#ecdbb5','#cdb995')+path('M39 103Q51 34 120 34Q187 35 203 102Q123 128 39 103Z','#ab7d59','#885d40')+line('M70 87q14-27 39-29','#c8a184',7),
 sushi:plate+path('M63 111Q123 85 181 111L178 153Q115 170 66 153Z','#fffdf0','#d8d2bc')+path('M50 103Q122 67 192 101L181 124Q118 105 63 129Z','#e58971','#bf6c58')+line('m80 99 20 21m18-28 22 24m18-20 19 20','#f6bea0',6),
 curry:plate+path('M46 132Q50 87 99 82Q137 85 142 148Q104 174 46 151Z','#fffbee','#ded4bb')+path('M123 91Q182 80 201 125Q220 158 163 169L115 161Z','#af7844','#916038')+path('m153 112 21 4-5 18-21-5Z','#d69c55')+path('m174 142 14-9 13 13-21 13Z','#db9546')+path('m126 133 17-2 9 18-19 8Z','#cea16a'),
 omelet:plate+path('M43 138Q49 70 123 74Q193 81 201 141Q130 183 43 138Z','#f2cd5d','#d7ac43')+path('M87 115q15-14 29 0t29 0t28 0','none','#cd6550',10)+line('M66 127q6-17 18-24','#ffe7a3',6),
 spaghetti:plate+Array.from({length:9},(_,i)=>path('M'+(58+i*10)+' 145q-12-49 20-44q32 5 18 44t22 0','none','#e8bd67',6)).join('')+path('M83 107Q91 84 124 94Q149  80 166 107L178 130Q157 147 125 134Q89 150 73 128Z','#ce7655')+leaf(135,110),
 pizza:path('M36 66Q126 30 210 66L122 190Z','#e3b878','#be9056')+path('M49 78Q126 51 194 78L122 175Z','#f0d079')+path('M43 69Q121 42 202 69','none','#cd9555',15)+[[89,91],[150,91],[121,133]].map(([x,y])=>circle(x,y,14,'#c96552')).join('')+path('m113  80 8-9 10 7-8 9m23 40 10-5 4 10-8 6','#7c9650'),
 hamburger:path('M46 108Q49  40 120 38Q191  40 194 108Z','#d9a15e','#b78446')+path('M47 154H194L187 181H54Z','#dca764','#b78446')+path('M47 129H192V153H47Z','#826046')+path('m47 115 19-6 17 7 18-7 19 9 19-10 18 8 17-7 19 9v12H47Z','#85a25b')+path('m65 146 56-5 38 7-40 16Z','#f0c656')+[[81,75],[112, 60],[145,72],[169,89]].map(([x,y])=>ellipse(x,y,4,2,'#f7dfae')).join(''),
 sandwich:plate+path('M53 67L196 150H53Z','#dbad70','#b8894e')+path('M62 81L179 148H62Z','#fff1c6')+path('M53 150H196V165H53Z','#88a75f')+path('M53 164H196V174H53Z','#df8b70')+path('M53 175H196V186H53Z','#e5b77a'),
 dumpling:plate+[0,49,98].map(dx=>'<g transform="translate('+dx+' 0)">'+path('M33 141Q36 83 87  90Q113 105 112 140Q73 163 33 141Z','#f0dfb5','#c2a77d')+line('m48 114 7 15m10-30 8  20m8-18 8 19m7-8 8 15','#c9ae85',3)+'</g>').join(''),
 udon:path('M 30 112H210L180 174Q121 195 60 174Z','#879ba2','#627c83')+ellipse(120,110,90,28,'#b89960')+Array.from({length:6},(_,i)=>path('M'+( 60+i*17)+' 119q-16- 30 8-30t8  30','none','#f6ebcb',9)).join('')+ellipse(163,100,17,13,'#f6e5c3')+ellipse(163,100,7,5,'#df9c9b')+path('m84 89 9-4 5 7-10 5m18 20 9-4 5 7-10 5','#749856'),
 soup:ellipse(120,105, 80,25,'#d9b76c')+path('M42 107H197Q195 172 120 181Q45 174 42 107Z','#e7ba70','#c49852')+line('M197 114q35-8 23 25q-8 15-29 10','#c49852',10)+path('m78 96 13-7 14 6-8 9m39-11 14-6 14 9-17 7','#e8cc8e')+path('m109 97 10-6 8 9-11 6','#7c9b60')+line('M89  60q-10-13 0-25m31 25q10-13 0-25m31 25q-10-13 0-25','#d6c2a0',4),
 donut:ellipse(120,114,86, 70,'#c28e55','#9b6a3d')+path('M39 103Q45  50 120 45Q195  50 204 107Q190 125 180 108Q163 127 149 112Q130 130 115 112Q98 132 81 113Q 60 129 39 103','#dfa69b')+ellipse(120,109, 30,24,'#fff8ed','#a87848')+line('m73  70 10 4m60-9 8 8m19 14 8-5m-88 14 8 5','#f5d981',4),
 pancake:plate+ellipse(120,150,84,25,'#b9854c')+ellipse(120,138,84,25,'#e7ba70')+ellipse(120,125,84,25,'#b9854c')+ellipse(120,112,84,25,'#e8bd70')+path('M71 108Q122  90 177 109Q173 122 146 123L142 148Q129 156 126 143L123 121Q91 124 71 108Z','#b78745')+path('m105  90  30-4 12 12- 30 7Z','#f6df8c'),
 pudding:plate+path('M81 73H159L181 151Q120 185 58 151Z','#eacb70','#c3a456')+ellipse(120,74,39,15,'#956440')+path('M81 75q36 19 78 0l4 20q-20 11-45 2l-4 21q-12 9-17-4l-3-18-17-6Z','#a77446'),
 icecream:path('M70 104H173L122 193Z','#d8ad70','#b48b52')+line('m85 126 59  40m-45-54 55 36m-3-28- 40  40m24- 50- 40  40','#b88f50',3)+circle(120, 70,56,'#f2c4b2')+ellipse(120,104, 60,17,'#f2c4b2')+line('M88 55q11-13 25-13','#ffe2ca',8),
 ricecracker:ellipse(120,116, 80, 70,'#c79650','#9f723b')+ellipse(120,111, 70, 60,'#dbb66e')+path('M89 104H153V183H89Z','#475e40')+line('m77 78 9-7m63 8 11 7m-91  50 6 8m95-4 6-8','#b18543',4),
 tofu:plate+path('M58 87L137  60L190 91L111 120Z','#fffdf0','#dedccb')+path('M58 87L111 120V174L58 141Z','#ecebdc','#d1d3c3')+path('M111 120L190 91V145L111 174Z','#f6f5e8','#d1d3c3')+path('m113 83 12-6 10 9-12 7m10-15 9-6 12 10-11 5','#799956'),
 cheese:path('M42 149L91  50L195 139V175H42Z','#e8c25d','#c3a146')+path('M42 149L91  50L195 139Z','#f4d67d','#d8b454')+ellipse(91,112,14,12,'#d8ae4e')+ellipse(133,130,12,8,'#d8ae4e')+ellipse(99, 80,8,6,'#d8ae4e')+ellipse(168,158,9,7,'#bc9140'),
 sausage:plate+path('M55 98Q114  50 181 98Q213 119 191 145Q175 161 156 142Q115 110  80 141Q59 160 43 141Q 20 120 55 98Z','#be7762','#9a5948')+line('m82 94 7 17m28-26 3 17m31-14-3 18m29-8-9 13','#e8ac8e',5)
};
// Each fact describes the pictured example, not every possible recipe or variety.
// Shared fact IDs are used consistently by all distractor selection and validation.
const knowledge={
 rice:['ingredient','おこめから つくるよ'],wheat:['ingredient','こむぎこを つかうよ'],egg:['ingredient','たまごを つかうよ'],milk:['ingredient','ぎゅうにゅうを つかうよ'],soy:['ingredient','だいずから つくるよ'],meat:['ingredient','おにくを つかうよ'],fish:['ingredient','さかなを つかうよ'],tomato:['ingredient','とまとを つかうよ'],sugar:['ingredient','おさとうを つかうよ'],water:['ingredient','みずを くわえて つくるよ'],
 boil:['preparation','おゆで ゆでて つくるよ'],simmer:['preparation','なべで にて つくるよ'],bake:['preparation','おーぶんで やいて つくるよ'],pan:['preparation','ふらいぱんで やいて つくるよ'],fry:['preparation','あぶらで あげて つくるよ'],cool:['preparation','ひやして かためるよ'],wrap:['preparation','なかみを つつんで つくるよ'],sandwich:['preparation','なかみを はさんで つくるよ'],cut:['preparation','きって わけて たべるよ'],peel:['preparation','そとの かわを むいて たべるよ'],raw:['preparation','ひで やかずに たべられるよ'],wash:['preparation','あらってから たべるよ'],
 tree:['growing','きの えだに なるよ'],vine:['growing','つるが のびて そだつよ'],ground:['growing','つちの なかで そだつ ところを たべるよ'],above:['growing','つちの うえに できるよ'],seed:['structure','なかに たねが あるよ'],oneSeed:['structure','なかに おおきな たねが ひとつ あるよ'],manySeed:['structure','なかに たねが たくさん あるよ'],skin:['structure','そとに かわが あるよ'],whiteInside:['structure','なかの みは しろっぽいよ'],yellowInside:['structure','なかの みは きいろいよ'],leafFood:['structure','はっぱの ところを たべるよ'],stemFood:['structure','くきの ところも たべるよ'],
 spoon:['serving','すぷーんで すくって たべるよ'],fork:['serving','ふぉーくで さして たべるよ'],chopsticks:['serving','おはしで はさんで たべるよ'],hand:['serving','てで もって たべるよ'],bowl:['serving','おわんに いれて たべるよ'],plate:['serving','おさらに のせて たべるよ'],soup:['serving','しるも いっしょに たべるよ'],
 knead:['preparation','こなを こねて つくるよ'],round:['preparation','まるく かたちを ととのえるよ'],steamRice:['preparation','おこめを たいて つくるよ'],chill:['serving','つめたく して たべるよ'],warm:['serving','あたためて たべるよ'],removeSeeds:['preparation','おおきな たねを とって たべるよ'],
 berryOutside:['structure','そとに ちいさな つぶつぶが あるよ'],sea:['growing','うみで くらす なかまが いるよ'],animal:['structure','どうぶつの なかまだよ'],bones:['structure','からだの なかに ほねが あるよ'],vegetableCook:['preparation','にものに つかうことが あるよ'],salad:['preparation','さらだに つかえる やさいだよ'],softHeat:['preparation','ひを とおすと やわらかく なるよ'],
 cream:['ingredient','くりーむを つかうよ'],butter:['ingredient','ばたーを のせて いるよ'],nori:['ingredient','のりを つかうよ'],riceFilling:['ingredient','なかに ごはんが はいって いるよ'],bread:['ingredient','ぱんを つかうよ'],cheese:['ingredient','ちーずを つかうよ'],pork:['ingredient','ぶたにくを つかうよ'],salt:['ingredient','おしおを つかうよ'],juice:['preparation','しぼって じゅーすに できるよ']
};
const rows=[
['rice','ごはん','しろい|つぶつぶが あつまって いる|おわんに はいって いる|みどりの おわんだよ|うえが やまの かたちだよ|まるい うつわだよ','rice water steamRice chopsticks bowl warm'],
['onigiri','おにぎり','しろい|さんかくの かたちだよ|くろい ところが ある|のりが まいて ある|ごはんが みえる|てで もてる かたちだよ','rice steamRice nori hand wrap salt'],
['bread','しょくぱん','しかくい かたちだよ|まわりが ちゃいろい|なかが うすい きいろだよ|うえが まるく ふくらんで いる|へいらな めんが ある|ひときれ みえる','wheat water knead bake hand cut'],
['egg','めだまやき','しろい|まんなかが きいろい|まんなかが まるい|そとが なみなみだよ|へいらな かたちだよ|きいろい まるが ひとつ ある','egg pan plate chopsticks warm'],
['noodles','らーめん','ながい めんが ある|おわんに はいって いる|ちゃいろい しるが ある|おはしが みえる|きいろい ところが ある|あかい おわんだよ','wheat water knead boil chopsticks bowl soup warm'],
['carrot','にんじん','おれんじいろだよ|やさいだよ|ほそながい|さきが とがって いる|みどりの はっぱが ある|ななめに なって いる','ground vegetableCook salad softHeat skin wash cut'],
['tomato','とまと','あかい|やさいだよ|まるい|みどりの へたが ある|ひとつ みえる|そとが つるっと して いる','above seed manySeed skin raw wash cut salad juice'],
['cucumber','きゅうり','みどりいろだよ|やさいだよ|ほそながい|すこし まがって いる|そとに つぶつぶが ある|ななめに なって いる','vine above seed manySeed skin raw wash cut salad'],
['banana','ばなな','きいろい|くだものだよ|ほそながい|すこし まがって いる|りょうはしが ちゃいろい|そとが つるっと して いる','above skin whiteInside peel hand raw cut'],
['apple','りんご','あかい|くだものだよ|まるい|みどりの はっぱが ある|うえに えだが ある|ひとつ みえる','tree seed skin whiteInside raw wash cut juice'],
['strawberry','いちご','あかい|くだものだよ|したが とがって いる|みどりの へたが ある|そとに つぶつぶが ある|ひとつ みえる','above raw wash hand berryOutside'],
['fish','さかな','あおいろだよ|おめめが ある|ひれが ある|しっぽが ある|よこに ながい|くちが ある','sea animal bones chopsticks plate'],
['grapes','ぶどう','むらさきいろだよ|くだものだよ|まるい つぶが ある|つぶつぶが あつまって いる|みどりの はっぱが ある|うえに えだが ある','vine above seed skin raw wash hand juice'],
['orange','みかん','おれんじいろだよ|くだものだよ|まるい|みどりの はっぱが ある|そとに つぶつぶが ある|ひとつ みえる','tree seed skin peel raw hand juice'],
['watermelon','すいか','あかい|くだものだよ|くろい つぶが ある|みどりの かわが ある|ひときれ みえる|したが まるく まがって いる','vine above seed manySeed skin cut raw hand juice'],
['peach','もも','ももいろだよ|くだものだよ|まるい|みどりの はっぱが ある|まんなかに すじが ある|したが とがって いる','tree seed oneSeed skin whiteInside peel raw cut removeSeeds juice'],
['pear','ようなし','きみどりいろだよ|くだものだよ|うえが ほそい|したが ふくらんで いる|みどりの はっぱが ある|そとに つぶつぶが ある','tree seed skin whiteInside peel raw cut juice'],
['pineapple','ぱいなっぷる','きいろい|くだものだよ|ながまるい|あみめの もようが ある|うえに とがった はっぱが ある|したが まるい','above skin yellowInside peel raw cut juice'],
['kiwi','きうい','みどりいろだよ|くだものだよ|くろい つぶが ある|まんなかが しろい|ちゃいろい かわが ある|きりくちが みえる','vine above seed manySeed skin peel raw cut spoon'],
['cherry','さくらんぼ','あかい|くだものだよ|まるい|ふたつ みえる|ながい えだが ある|みどりの はっぱが ある','tree seed oneSeed skin raw wash hand removeSeeds'],
['lemon','れもん','きいろい|くだものだよ|ながまるい|りょうはしが とがって いる|みどりの はっぱが ある|ひとつ みえる','tree seed skin yellowInside cut raw juice'],
['melon','めろん','きみどりいろだよ|くだものだよ|まるい|あみめの もようが ある|うえに えだが ある|ひとつ みえる','vine above seed manySeed skin cut raw spoon juice'],
['potato','じゃがいも','ちゃいろい|やさいだよ|まるみが ある|そとに くぼみが ある|はっぱが みえない|ひとつ みえる','ground skin peel vegetableCook softHeat cut'],
['sweetpotato','さつまいも','むらさきいろだよ|やさいだよ|ほそながい|きりくちが みえる|なかが きいろい|ななめに なって いる','ground skin yellowInside vegetableCook softHeat cut'],
['pumpkin','かぼちゃ','おれんじいろだよ|やさいだよ|まるい|たてに すじが ある|みどりの へたが ある|ひとつ みえる','vine above seed manySeed skin yellowInside vegetableCook softHeat cut'],
['eggplant','なす','むらさきいろだよ|やさいだよ|ほそながい|すこし まがって いる|みどりの へたが ある|したが ふくらんで いる','above seed manySeed skin whiteInside vegetableCook softHeat cut'],
['corn','とうもろこし','きいろい|やさいだよ|つぶつぶが あつまって いる|ながまるい|みどりの はっぱが ある|つぶが ならんで いる','above skin peel boil hand softHeat'],
['broccoli','ぶろっこりー','みどりいろだよ|やさいだよ|うえが もこもこだよ|くきが みえる|きのような かたちだよ|みどりの こぶが あつまって いる','above stemFood boil salad softHeat cut wash'],
['cabbage','きゃべつ','きみどりいろだよ|やさいだよ|まるい|はっぱが かさなって いる|はっぱに すじが ある|ひとつ みえる','above leafFood raw wash cut salad vegetableCook softHeat'],
['onion','たまねぎ','ちゃいろい|やさいだよ|まるい|うえが とがって いる|たてに すじが ある|したに ねが ある','ground skin whiteInside peel vegetableCook softHeat cut'],
['radish','だいこん','しろい|やさいだよ|ほそながい|したが とがって いる|みどりの はっぱが ある|そとに よこの すじが ある','ground skin whiteInside raw wash cut salad vegetableCook softHeat'],
['mushroom','しいたけ','ちゃいろい|かさの かたちだよ|くきが みえる|したが しろっぽい|うえが まるい|ひとつ みえる','above stemFood vegetableCook softHeat cut wash'],
['sushi','おすし','ごはんが みえる|うえが ももいろだよ|しかくい かたちだよ|おさらに のって いる|うえに すじが ある|したが しろい','rice steamRice fish hand chopsticks plate'],
['curry','かれーらいす','ごはんが みえる|ちゃいろい ところが ある|おさらに のって いる|しろい ところが ある|しかくい ぐが ある|ふたつの いろに わかれて いる','rice steamRice simmer spoon plate warm water'],
['omelet','おむらいす','きいろい|ながまるい|おさらに のって いる|あかい ところが ある|あかい せんが なみなみだよ|うえが ふくらんで いる','rice riceFilling egg pan wrap spoon plate warm tomato'],
['spaghetti','すぱげってぃ','ながい めんが ある|きいろい ところが ある|おさらに のって いる|あかい ところが ある|みどりの はっぱが ある|めんが まがって いる','wheat water knead boil tomato fork plate warm'],
['pizza','ぴざ','さんかくの かたちだよ|きいろい ところが ある|あかい まるが ある|まわりが ちゃいろい|ひときれ みえる|みどりの ところが ある','wheat water knead bake tomato cheese hand cut'],
['hamburger','はんばーがー','うえが まるく ふくらんで いる|ちゃいろい ところが ある|みどりの ところが ある|きいろい ところが ある|なんだんも かさなって いる|うえに ちいさな つぶが ある','wheat bread meat cheese sandwich hand warm'],
['sandwich','さんどいっち','さんかくの かたちだよ|みどりの ところが ある|ももいろの ところが ある|おさらに のって いる|なんだんも かさなって いる|うえが しろっぽい','wheat bread sandwich hand cut plate'],
['dumpling','ぎょうざ','しろっぽい|みっつ みえる|そとに すじが ある|したが まるく まがって いる|おさらに のって いる|はんぶんの まるの かたちだよ','wheat water meat pork knead wrap pan chopsticks plate warm'],
['udon','うどん','ながい めんが ある|おわんに はいって いる|めんが しろい|めんが ふとい|ちゃいろい しるが ある|あおい おわんだよ','wheat water knead boil chopsticks bowl soup warm'],
['soup','すーぷ','おわんに はいって いる|きいろい ところが ある|とってが ある|ゆげが みえる|ぐが ういて いる|みどりの ところが ある','water simmer spoon bowl soup warm'],
['donut','どーなつ','おかしだよ|まるい|まんなかに あなが ある|ももいろの ところが ある|したが ちゃいろい|うえに みじかい せんが ある','wheat sugar egg water knead fry hand'],
['pancake','ほっとけーき','まるい|ちゃいろい ところが ある|なんだんも かさなって いる|おさらに のって いる|うえに きいろい しかくが ある|ちゃいろい しるが かかって いる','wheat egg milk sugar butter pan fork plate warm'],
['pudding','ぷりん','おかしだよ|きいろい|うえが ちゃいろい|うえが ほそい|したが ひろい|おさらに のって いる','egg milk sugar chill spoon plate'],
['icecream','あいすくりーむ','おかしだよ|ももいろの ところが ある|うえが まるい|したが とがって いる|したに あみめが ある|ちゃいろい ところが ある','milk cream sugar cool chill hand'],
['ricecracker','おせんべい','おかしだよ|まるい|ちゃいろい|くろい ところが ある|のりが まいて ある|へいらな かたちだよ','rice water nori bake hand'],
['tofu','とうふ','しろい|しかくい かたちだよ|みどりの ところが ある|おさらに のって いる|へいらな めんが ある|しかくい かどが ある','soy water chopsticks plate cut'],
['cheese','ちーず','きいろい|さんかくの かたちだよ|まるい あなが ある|へいらな めんが ある|したが まっすぐだよ|ひときれ みえる','milk hand cut plate'],
['sausage','そーせーじ','ちゃいろい|ほそながい|すこし まがって いる|そとに ななめの すじが ある|りょうはしが まるい|おさらに のって いる','meat pork salt pan fork plate warm']
];
const factMap=new Map(),factTextIds=new Map();
function registerFact(id,text,kind){if(factMap.has(id)&&factMap.get(id).text!==text)throw new Error('Fact ID conflict '+id);factMap.set(id,{id,text,kind});return id;}
Object.entries(knowledge).forEach(([id,[kind,text]])=>registerFact('k:'+id,text,kind));
function visualFact(text){let id=factTextIds.get(text);if(!id){id='v:'+String(factTextIds.size+1).padStart(3,'0');factTextIds.set(text,id);registerFact(id,text,'appearance');}return id;}
const foods=rows.map(([id,name,visual,keys])=>{const visualFacts=visual.split('|').map(visualFact),knowledgeFacts=keys.split(' ').map(k=>{if(!knowledge[k])throw new Error('Unknown knowledge '+k);return 'k:'+k;});const nameFact=registerFact('name:'+id,'「'+name+'」は どれかな？','name');return {id,name,svg:wrap(art[id]),visualFacts,knowledgeFacts,facts:[nameFact,...visualFacts,...knowledgeFacts]};});
const foodById=new Map(foods.map(f=>[f.id,f]));
// Three-state matching: unlisted knowledge is not automatically false.
// For a pictured mixed recipe, optional ingredients and cooking variations stay
// POSSIBLE. Only an explicitly incompatible cue can eliminate a distractor.
const produceIds=new Set(['carrot','tomato','cucumber','banana','apple','strawberry','grapes','orange','watermelon','peach','pear','pineapple','kiwi','cherry','lemon','melon','potato','sweetpotato','pumpkin','eggplant','corn','broccoli','cabbage','onion','radish','mushroom']);
const broadKnowledge=new Set(['cut','wash','raw','juice','removeSeeds','round','softHeat','vegetableCook','salad','peel','skin','warm','chill','spoon','fork','chopsticks','hand','bowl','plate','soup']);
const unhelpfulVisual=/ひとつ みえる|まるみが ある|へいらな めんが ある|てで もてる/;
const visualFacts=[...factMap.values()].filter(f=>f.kind==='appearance');
const colorFamilies=[/しろ|しろっぽ/,/きいろ/,/ちゃいろ/,/あかい/,/みどり|きみどり/,/ももいろ/,/むらさき/,/おれんじ/,/あおい/];
const shapeFamilies=[/まる|ふくらん/,/さんかく|とがっ/,/しかく|かど/,/ながい|ながまる/,/つぶ|もこもこ|こぶ/,/すじ|せん/,/まがっ|なみなみ/];
for(const food of foods){
 const possible=new Set(food.facts);
 if(food.facts.includes('k:tree')||food.facts.includes('k:vine')){if(!food.facts.includes('k:above'))food.facts.push('k:above');possible.add('k:above');}
 const ownText=food.visualFacts.map(id=>factMap.get(id).text).join('|');
 for(const f of visualFacts){
  if(unhelpfulVisual.test(f.text))possible.add(f.id);
  if([...colorFamilies,...shapeFamilies].some(pattern=>pattern.test(ownText)&&pattern.test(f.text)))possible.add(f.id);
 }
 for(const f of factMap.values()){
  if(!f.id.startsWith('k:'))continue;
  const key=f.id.slice(2);
  if(broadKnowledge.has(key))possible.add(f.id);
  if(!produceIds.has(food.id)&&food.id!=='fish'&&['ingredient','preparation','structure'].includes(f.kind))possible.add(f.id);
 }
 if(possible.has('k:seed')&&!food.facts.includes('k:oneSeed'))possible.add('k:manySeed'); food.possibleFacts=[...possible];
 food.visualFacts=food.visualFacts.filter(id=>!unhelpfulVisual.test(factMap.get(id).text));
 food.knowledgeFacts=food.knowledgeFacts.filter(id=>factMap.get(id).kind!=='serving'&&!broadKnowledge.has(id.slice(2)));
}
const hasAll=(food,ids)=>ids.every(id=>food.possibleFacts.includes(id));
const combinations=(items,n)=>{const out=[];function visit(start,acc){if(acc.length===n){out.push(acc);return;}for(let i=start;i<items.length;i++)visit(i+1,[...acc,items[i]]);}visit(0,[]);return out;};
function hash(text){let n=2166136261;for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
function distractors(food,facts,difficulty){const candidates=foods.filter(other=>other!==food&&!hasAll(other,facts));const pairs=combinations(candidates,2);let best=null,bestScore=-Infinity;for(const pair of pairs){const matches=pair.map(other=>facts.filter(id=>other.possibleFacts.includes(id)).length);if(difficulty==='hard'&&(!facts.every(id=>pair.some(other=>other.possibleFacts.includes(id)))||!facts.every(id=>pair.some(other=>other.facts.includes(id)))))continue;const coverage=matches[0]+matches[1];const knownCoverage=pair.reduce((n,other)=>n+facts.filter(id=>other.facts.includes(id)).length,0);const score=(difficulty==='easy'?-knownCoverage:knownCoverage)*100000000000000+(difficulty==='easy'?-coverage:coverage)*10000000000+hash(food.id+facts.join('|')+pair.map(f=>f.id).join('|'));if(score>bestScore){best=pair;bestScore=score;}}return best?best.map(f=>f.id):null;}
const questions=[],clueSet=new Set(),semanticSet=new Set();
function substantive(facts){
 const texts=facts.filter(id=>id.startsWith('v:')).map(id=>factMap.get(id).text);
 if(facts.includes('k:berryOutside')&&texts.some(t=>/そとに つぶつぶ/.test(t)))return false;
 if(facts.includes('k:nori')&&texts.some(t=>/のり/.test(t)))return false;
 if((facts.includes('k:rice')||facts.includes('k:steamRice'))&&texts.some(t=>/ごはん/.test(t)))return false;
 if(texts.length>1){
  const [a,b]=texts;
  if(a.includes(b)||b.includes(a))return false;
  if(/おわん|うつわ/.test(a)&&/おわん|うつわ/.test(b))return false;
  if(/つぶ/.test(a)&&/つぶ/.test(b))return false;
  if(/はっぱ/.test(a)&&/はっぱ/.test(b))return false;
  if(/きいろい まる/.test(a+b)&&/まんなかが まるい|まんなかが きいろい/.test(a+b))return false;
  if(/まる|もこもこ|こぶ/.test(a)&&/まる|もこもこ|こぶ/.test(b))return false;
 }
 return true;
}
function add(food,difficulty,facts){if(!substantive(facts))return false;const signature=food.id+'|'+[...facts].sort().join('|');if(semanticSet.has(signature))return false;const clue=facts.length===1?factMap.get(facts[0]).text:facts.map(id=>factMap.get(id).text+'。').join('\n')+'\nどれかな？';if(clueSet.has(clue))return false;const other=distractors(food,facts,difficulty);if(!other)return false;const id='food-'+difficulty+'-'+food.id+'-'+String(questions.filter(q=>q.answer===food.id&&q.difficulty===difficulty).length+1).padStart(2,'0');questions.push({id,difficulty,answer:food.id,choices:[food.id,...other],clue,facts:[...facts]});semanticSet.add(signature);clueSet.add(clue);return true;}
function fill(food,difficulty,candidates,count){let added=0;for(const ids of candidates){if(add(food,difficulty,ids)&&++added===count)break;}if(added!==count)throw new Error('Not enough substantive '+difficulty+' facts for '+food.id+': '+added+'/'+count);}
const order=(food,list)=>list.sort((a,b)=>hash(food.id+a.join('|'))-hash(food.id+b.join('|')));
const redundantPairs=new Set(['rice|steamRice','bread|wheat','cool|chill','skin|peel','raw|wash','ground|vegetableCook','tree|above','vine|above','seed|manySeed','seed|oneSeed'].map(pair=>pair.split('|').sort().join('|')));
const independent=pair=>factMap.get(pair[0]).kind!==factMap.get(pair[1]).kind&&!redundantPairs.has(pair.map(id=>id.slice(2)).sort().join('|'));
function fillTier(difficulty,pools,target){let count=0;while(count<target){let progress=false;for(const pool of pools){while(pool.candidates.length){if(add(pool.food,difficulty,pool.candidates.shift())){count++;progress=true;break;}}if(count===target)break;}if(!progress)throw new Error('Insufficient meaningful '+difficulty+' questions: '+count);}}
fillTier('easy',foods.map(food=>({food,candidates:[[food.facts[0]],...order(food,combinations(food.visualFacts,2))]})),400);
fillTier('normal',foods.map(food=>({food,candidates:order(food,food.knowledgeFacts.flatMap(k=>food.visualFacts.map(v=>[v,k])))})),350);
const hardPools=foods.map(food=>({food,candidates:order(food,[...combinations(food.knowledgeFacts,2).filter(independent).flatMap(pair=>food.visualFacts.map(v=>[v,...pair])),...combinations(food.visualFacts,2).flatMap(pair=>food.knowledgeFacts.map(k=>[...pair,k]))])}));
let hardCount=0;
while(hardCount<250){let progress=false;for(const pool of hardPools){while(pool.candidates.length){if(add(pool.food,'hard',pool.candidates.shift())){hardCount++;progress=true;break;}}if(hardCount===250)break;}if(!progress)throw new Error('Insufficient meaningful hard questions: '+hardCount);}
const levels=[{id:'easy',name:'やさしい',count:400,description:'なまえや いろ、かたちを みよう。'},{id:'normal',name:'ふつう',count:350,description:'なにから できる？ どう たべる？'},{id:'hard',name:'むずかしい',count:250,description:'みっつの ひんとを あわせよう。'}];
if(foods.length!==50||questions.length!==1000)throw new Error('Wrong bank size');
for(const q of questions){if(q.choices.length!==3||new Set(q.choices).size!==3||q.choices.filter(id=>hasAll(foodById.get(id),q.facts)).join()!==q.answer)throw new Error('Ambiguous question '+q.id);}
return {version:1,foods,questions,levels,facts:[...factMap.values()]};
});









